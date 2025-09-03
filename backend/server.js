const express = require('express');
const multer = require('multer');
const cors = require('cors');
const helmet = require('helmet');
const crypto = require('crypto');
const fs = require('fs').promises;
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const FRONTEND_URL = process.env.FRONTEND_URL || 'https://lucasnegerson-eng.github.io/cosmic-uploads';

// Security middleware
app.use(helmet());
app.use(cors({
    origin: FRONTEND_URL,
    credentials: true
}));
app.use(express.json());

// Ensure uploads directory exists
const uploadsDir = path.join(__dirname, 'uploads');
fs.mkdir(uploadsDir, { recursive: true }).catch(console.error);

// Multer storage
const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, uploadsDir),
    filename: (req, file, cb) => {
        const fileId = crypto.randomBytes(16).toString('hex');
        const ext = path.extname(file.originalname);
        cb(null, `${fileId}${ext}`);
    }
});

const upload = multer({
    storage: storage,
    limits: { fileSize: 1024 * 1024 * 1024 },
    fileFilter: (req, file, cb) => cb(null, true)
});

// File metadata in memory
const fileMetadata = new Map();

// Helpers for cleaning expired files & storage management
const cleanExpiredFiles = async () => {
    const now = Date.now();
    for (const [fileId, metadata] of fileMetadata.entries()) {
        if (now - metadata.uploadTime > 24*60*60*1000) {
            try { await fs.unlink(metadata.filePath); fileMetadata.delete(fileId); } catch(e){console.error(e);}
        }
    }
};
const manageStorageCapacity = async () => {
    const MAX_STORAGE = 5*1024*1024*1024;
    let totalSize = 0;
    const files = Array.from(fileMetadata.entries())
        .map(([id, metadata]) => ({id, ...metadata}))
        .sort((a,b)=>a.uploadTime-b.uploadTime);
    for (const file of files) totalSize += file.size;
    while(totalSize>MAX_STORAGE && files.length>0){
        const oldest = files.shift();
        try{ await fs.unlink(oldest.filePath); fileMetadata.delete(oldest.id); totalSize -= oldest.size; } catch(e){console.error(e);}
    }
};
setInterval(cleanExpiredFiles, 60*60*1000);
setInterval(manageStorageCapacity, 10*60*1000);

// Upload endpoint
app.post('/api/upload', upload.single('file'), async (req,res)=>{
    try {
        if(!req.file) return res.status(400).json({error:'No file uploaded'});
        const fileId = path.basename(req.file.filename,path.extname(req.file.filename));
        const metadata = {
            originalName: req.file.originalname,
            size: req.file.size,
            mimetype: req.file.mimetype,
            uploadTime: Date.now(),
            filePath: req.file.path,
            filename: req.file.filename
        };
        fileMetadata.set(fileId,metadata);
        await manageStorageCapacity();
        res.json({fileId,message:'File uploaded successfully',expiresAt:new Date(Date.now()+24*60*60*1000).toISOString()});
    } catch(e){ console.error(e); res.status(500).json({error:'Upload failed'}); }
});

// File metadata endpoint
app.get('/api/file/:fileId',(req,res)=>{
    const {fileId}=req.params;
    const metadata=fileMetadata.get(fileId);
    if(!metadata) return res.status(404).json({error:'File not found'});
    if(Date.now()-metadata.uploadTime>24*60*60*1000){
        fileMetadata.delete(fileId); fs.unlink(metadata.filePath).catch(()=>{}); 
        return res.status(404).json({error:'File has expired'});
    }
    res.json({fileId, originalName:metadata.originalName, size:metadata.size, mimetype:metadata.mimetype, uploadTime:metadata.uploadTime, expiresAt:new Date(metadata.uploadTime+24*60*60*1000).toISOString()});
});

// Download endpoint
app.get('/api/download/:fileId', async(req,res)=>{
    try {
        const {fileId}=req.params;
        const metadata=fileMetadata.get(fileId);
        if(!metadata) return res.status(404).json({error:'File not found'});
        if(Date.now()-metadata.uploadTime>24*60*60*1000){
            fileMetadata.delete(fileId); await fs.unlink(metadata.filePath).catch(()=>{}); 
            return res.status(404).json({error:'File has expired'});
        }
        try{ await fs.access(metadata.filePath); } catch(e){ fileMetadata.delete(fileId); return res.status(404).json({error:'File not found on disk'});}
        res.setHeader('Content-Disposition',`attachment; filename="${metadata.originalName}"`);
        res.setHeader('Content-Type', metadata.mimetype);
        res.sendFile(path.resolve(metadata.filePath));
    } catch(e){ console.error(e); res.status(500).json({error:'Download failed'});}
});

// Preview endpoint
app.get('/api/preview/:fileId', async(req,res)=>{
    try{
        const {fileId}=req.params;
        const metadata=fileMetadata.get(fileId);
        if(!metadata) return res.status(404).json({error:'File not found'});
        if(Date.now()-metadata.uploadTime>24*60*60*1000){
            fileMetadata.delete(fileId); await fs.unlink(metadata.filePath).catch(()=>{}); 
            return res.status(404).json({error:'File has expired'});
        }
        const previewableTypes=['image/','text/','application/json','application/pdf'];
        if(!previewableTypes.some(type=>metadata.mimetype.startsWith(type))) return res.status(400).json({error:'File type not previewable'});
        res.setHeader('Content-Type', metadata.mimetype);
        res.sendFile(path.resolve(metadata.filePath));
    } catch(e){ console.error(e); res.status(500).json({error:'Preview failed'});}
});

// Health check
app.get('/api/health',(req,res)=>res.json({status:'OK',timestamp:new Date().toISOString()}));

// ==== NEW: Dynamic file page for Discord embeds ====
app.get('/file/:fileId', async (req,res)=>{
    const {fileId} = req.params;
    const metadata = fileMetadata.get(fileId);
    if(!metadata) return res.status(404).send('File not found');

    // Determine embed data
    let title = metadata.originalName;
    let description = `File: ${metadata.originalName} • Size: ${(metadata.size/(1024*1024)).toFixed(2)} MB • Expires in 24h`;
    let image = '';
    if(metadata.mimetype.startsWith('image/')) image = `${req.protocol}://${req.get('host')}/api/preview/${fileId}`;
    
    // Serve minimal HTML with OG tags
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

app.listen(PORT, ()=>{
    console.log(`Cosmic Uploads backend running on port ${PORT}`);
    cleanExpiredFiles();
    manageStorageCapacity();
});
