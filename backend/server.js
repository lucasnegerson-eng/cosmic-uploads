const express = require('express');
const multer = require('multer');
const cors = require('cors');
const helmet = require('helmet');
const crypto = require('crypto');
const fs = require('fs').promises;
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const FRONTEND_URL = process.env.FRONTEND_URL || 'https://cosmic-uploads.vercel.app';

// ===== Middleware =====
app.use(helmet());

// Dynamic CORS
const allowedOrigins = [
    FRONTEND_URL,
    'http://localhost:3000', // local dev
];
app.use(cors({
    origin: (origin, callback) => {
        if (!origin) return callback(null, true); // allow non-browser requests
        if (allowedOrigins.includes(origin)) callback(null, true);
        else callback(new Error('Not allowed by CORS'));
    },
    credentials: true
}));

app.options('*', cors()); // preflight support
app.use(express.json());

// ===== Ensure uploads dir exists =====
const uploadsDir = path.join(__dirname, 'uploads');
fs.mkdir(uploadsDir, { recursive: true }).catch(console.error);

// ===== Multer setup =====
const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, uploadsDir),
    filename: (req, file, cb) => {
        const fileId = crypto.randomBytes(16).toString('hex');
        const ext = path.extname(file.originalname);
        cb(null, `${fileId}${ext}`);
    }
});

const upload = multer({
    storage,
    limits: { fileSize: 1024 * 1024 * 1024 }, // 1GB
    fileFilter: (req, file, cb) => cb(null, true)
});

// ===== In-memory file metadata =====
const fileMetadata = new Map();

// ===== Storage & cleanup helpers =====
const cleanExpiredFiles = async () => {
    const now = Date.now();
    for (const [fileId, metadata] of fileMetadata.entries()) {
        if (now - metadata.uploadTime > 24 * 60 * 60 * 1000) {
            try { await fs.unlink(metadata.filePath); fileMetadata.delete(fileId); } catch(e){console.error(e);}
        }
    }
};

const manageStorageCapacity = async () => {
    const MAX_STORAGE = 5 * 1024 * 1024 * 1024; // 5GB
    let totalSize = 0;
    const files = Array.from(fileMetadata.entries())
        .map(([id, metadata]) => ({ id, ...metadata }))
        .sort((a, b) => a.uploadTime - b.uploadTime);
    for (const file of files) totalSize += file.size;
    while(totalSize > MAX_STORAGE && files.length > 0){
        const oldest = files.shift();
        try { await fs.unlink(oldest.filePath); fileMetadata.delete(oldest.id); totalSize -= oldest.size; } catch(e){console.error(e);}
    }
};

setInterval(cleanExpiredFiles, 60*60*1000);
setInterval(manageStorageCapacity, 10*60*1000);

// ===== Routes =====

// Upload
app.post('/api/upload', upload.single('file'), async (req, res) => {
    try {
        if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

        const fileId = path.basename(req.file.filename, path.extname(req.file.filename));
        const metadata = {
            originalName: req.file.originalname,
            size: req.file.size,
            mimetype: req.file.mimetype,
            uploadTime: Date.now(),
            filePath: req.file.path,
            filename: req.file.filename
        };
        fileMetadata.set(fileId, metadata);
        await manageStorageCapacity();

        res.json({
            fileId,
            message: 'File uploaded successfully',
            expiresAt: new Date(Date.now() + 24*60*60*1000).toISOString()
        });
    } catch(e) { 
        console.error(e); 
        res.status(500).json({ error: 'Upload failed' }); 
    }
});

// File metadata
app.get('/api/file/:fileId', (req, res) => {
    const { fileId } = req.params;
    const metadata = fileMetadata.get(fileId);
    if (!metadata) return res.status(404).json({ error: 'File not found' });
    if (Date.now() - metadata.uploadTime > 24*60*60*1000) {
        fileMetadata.delete(fileId);
        fs.unlink(metadata.filePath).catch(()=>{});
        return res.status(404).json({ error: 'File has expired' });
    }
    res.json({
        fileId,
        originalName: metadata.originalName,
        size: metadata.size,
        mimetype: metadata.mimetype,
        uploadTime: metadata.uploadTime,
        expiresAt: new Date(metadata.uploadTime + 24*60*60*1000).toISOString()
    });
});

// Download
app.get('/api/download/:fileId', async (req, res) => {
    try {
        const { fileId } = req.params;
        const metadata = fileMetadata.get(fileId);
        if (!metadata) return res.status(404).json({ error: 'File not found' });
        if (Date.now() - metadata.uploadTime > 24*60*60*1000) {
            fileMetadata.delete(fileId);
            await fs.unlink(metadata.filePath).catch(()=>{});
            return res.status(404).json({ error: 'File has expired' });
        }
        await fs.access(metadata.filePath).catch(() => { throw new Error('File missing'); });
        res.setHeader('Content-Disposition', `attachment; filename="${metadata.originalName}"`);
        res.setHeader('Content-Type', metadata.mimetype);
        res.sendFile(path.resolve(metadata.filePath));
    } catch(e) {
        console.error(e);
        res.status(500).json({ error: 'Download failed' });
    }
});

// Preview
app.get('/api/preview/:fileId', async (req, res) => {
    try {
        const { fileId } = req.params;
        const metadata = fileMetadata.get(fileId);
        if (!metadata) return res.status(404).json({ error: 'File not found' });
        if (Date.now() - metadata.uploadTime > 24*60*60*1000) {
            fileMetadata.delete(fileId);
            await fs.unlink(metadata.filePath).catch(()=>{});
            return res.status(404).json({ error: 'File has expired' });
        }
        const previewableTypes = ['image/', 'text/', 'application/json', 'application/pdf'];
        if (!previewableTypes.some(type => metadata.mimetype.startsWith(type)))
            return res.status(400).json({ error: 'File type not previewable' });

        res.setHeader('Content-Type', metadata.mimetype);
        res.sendFile(path.resolve(metadata.filePath));
    } catch(e) {
        console.error(e);
        res.status(500).json({ error: 'Preview failed' });
    }
});

// Health
app.get('/api/health', (req, res) => res.json({ status: 'OK', timestamp: new Date().toISOString() }));

// File page for Discord/OG embeds
app.get('/file/:fileId', async (req, res) => {
    const { fileId } = req.params;
    const metadata = fileMetadata.get(fileId);
    if (!metadata) return res.status(404).send('File not found');

    const title = metadata.originalName;
    const description = `File: ${metadata.originalName} • Size: ${(metadata.size/(1024*1024)).toFixed(2)} MB • Expires in 24h`;
    const image = metadata.mimetype.startsWith('image/') ? `${req.protocol}://${req.get('host')}/api/preview/${fileId}` : '';

    res.send(`
        <!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <meta property="og:title" content="${title}" />
            <meta property="og:description" content="${description}" />
            ${image ? `<meta property="og:image" content="${image}" />` : ''}
            <meta name="twitter:card" content="${image ? 'summary_large_image' : 'summary'}" />
            <title>${title}</title>
            <meta http-equiv="refresh" content="0; url=${FRONTEND_URL}/file.html?id=${fileId}" />
        </head>
        <body>
            Redirecting to file page...
        </body>
        </html>
    `);
});

// Start server
app.listen(PORT, () => {
    console.log(`Cosmic Uploads backend running on port ${PORT}`);
    cleanExpiredFiles();
    manageStorageCapacity();
});
