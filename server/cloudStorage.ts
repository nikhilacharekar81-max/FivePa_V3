import { Storage } from '@google-cloud/storage';
import fs from 'fs';
import path from 'path';

const bucketName = process.env.GCS_BUCKET_NAME || process.env.CLOUD_STORAGE_BUCKET || 'workperhour-uploads-bucket';
const storage = new Storage();
const bucket = storage.bucket(bucketName);

export async function uploadFileToCloudStorage(filename: string, buffer: Buffer, mimeType: string): Promise<string> {
  const isTestOrLocal = process.env.NODE_ENV === 'test' || (!process.env.GCS_BUCKET_NAME && !process.env.GOOGLE_CLOUD_PROJECT && process.env.NODE_ENV !== 'production');
  
  if (isTestOrLocal) {
    const localDir = path.join(process.cwd(), 'data', 'uploads', 'workstream');
    if (!fs.existsSync(localDir)) fs.mkdirSync(localDir, { recursive: true });
    const localPath = path.join(localDir, filename);
    fs.writeFileSync(localPath, buffer);
    return `/uploads/workstream/${filename}`;
  }

  try {
    const file = bucket.file(`workstream/${filename}`);
    await file.save(buffer, {
      contentType: mimeType,
      resumable: false,
    });
    return `https://storage.googleapis.com/${bucketName}/workstream/${filename}`;
  } catch (err) {
    console.error('[CloudStorage ERROR] Failed to upload file to GCS:', err);
    throw err;
  }
}

export async function deleteFileFromCloudStorage(filename: string): Promise<void> {
  const isTestOrLocal = process.env.NODE_ENV === 'test' || (!process.env.GCS_BUCKET_NAME && !process.env.GOOGLE_CLOUD_PROJECT && process.env.NODE_ENV !== 'production');
  if (isTestOrLocal) {
    const localPath = path.join(process.cwd(), 'data', 'uploads', 'workstream', filename);
    try { if (fs.existsSync(localPath)) fs.unlinkSync(localPath); } catch {}
    return;
  }

  try {
    const file = bucket.file(`workstream/${filename}`);
    await file.delete({ ignoreNotFound: true });
  } catch (err) {
    console.error('[CloudStorage ERROR] Failed to delete file from GCS:', err);
  }
}
