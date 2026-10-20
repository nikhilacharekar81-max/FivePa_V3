// src/utils/workstreamUpload.ts
import { getAuthToken } from './authToken';

const MAX_FILE_SIZE_MB = 25;
const ALLOWED_EXTENSIONS = ['jpg', 'jpeg', 'png', 'gif', 'pdf', 'zip', 'rar', 'tar', 'gz', '7z', 'txt', 'docx', 'xlsx'];

interface UploadResult {
  name: string;
  size: string;
  url: string;
}

export async function uploadWorkstreamFile(file: File): Promise<UploadResult> {
  // 1. Client-side validation
  const fileSizeMB = file.size / (1024 * 1024);
  if (fileSizeMB > MAX_FILE_SIZE_MB) {
    throw new Error(`File is too large. Maximum size is ${MAX_FILE_SIZE_MB} MB.`);
  }

  const extension = file.name.split('.').pop()?.toLowerCase();
  if (!extension || !ALLOWED_EXTENSIONS.includes(extension)) {
    throw new Error(`File type .${extension} is not allowed.`);
  }

  // 2. Upload
  const res = await fetch(`/api/workstream/upload?name=${encodeURIComponent(file.name)}`, {
    method: 'POST',
    headers: {
      'Content-Type': file.type || 'application/octet-stream',
      ...((getAuthToken())
        ? { 'Authorization': `Bearer ${getAuthToken()}` }
        : {})
    },
    body: file
  });

  if (!res.ok) {
    const errorData = await res.json().catch(() => ({}));
    throw new Error(errorData.message || 'File upload failed.');
  }

  // 3. Response validation
  const data = await res.json();
  if (!data.url) {
    throw new Error('Upload failed: No URL returned from server.');
  }

  const fallbackSizeStr = file.size > 1024 * 1024
    ? `${(file.size / (1024 * 1024)).toFixed(1)} MB`
    : `${Math.round(file.size / 1024)} KB`;

  return {
    name: data.name || file.name,
    size: data.size || fallbackSizeStr,
    url: data.url
  };
}
