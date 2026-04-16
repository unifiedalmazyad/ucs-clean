import { useState, useCallback } from "react";

interface UploadResponse {
  objectPath: string;
}

interface UseUploadOptions {
  onSuccess?: (response: UploadResponse) => void;
  onError?: (error: Error) => void;
  maxSizeMB?: number;
}

const ALLOWED_EXTENSIONS = ['pdf','doc','docx','xls','xlsx','png','jpg','jpeg','zip'];
const DEFAULT_MAX_MB = 100;

export function useUpload(options: UseUploadOptions = {}) {
  const [isUploading, setIsUploading] = useState(false);
  const [error, setError]             = useState<Error | null>(null);
  const [progress, setProgress]       = useState(0);

  const maxMB = options.maxSizeMB ?? DEFAULT_MAX_MB;

  const getToken = () => localStorage.getItem('token') || '';

  const uploadFile = useCallback(async (file: File): Promise<UploadResponse | null> => {
    setIsUploading(true);
    setError(null);
    setProgress(5);

    try {
      // ── Frontend pre-checks (fast feedback before hitting the server) ──────
      const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
      if (!ALLOWED_EXTENSIONS.includes(ext)) {
        throw new Error(`نوع الملف (.${ext}) غير مسموح. الأنواع المقبولة: PDF, Word, Excel, صور, ZIP`);
      }

      if (file.size === 0) {
        throw new Error('الملف فارغ، يرجى اختيار ملف صحيح');
      }

      const maxBytes = maxMB * 1024 * 1024;
      if (file.size > maxBytes) {
        throw new Error(`حجم الملف (${(file.size / 1024 / 1024).toFixed(1)} MB) يتجاوز الحد المسموح (${maxMB} MB)`);
      }

      setProgress(20);

      // Upload file directly to backend as multipart/form-data
      const formData = new FormData();
      formData.append('file', file);

      const r = await fetch('/api/uploads/file', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${getToken()}`,
          // Do NOT set Content-Type — browser sets it automatically with the correct multipart boundary
        },
        body: formData,
      });

      setProgress(90);

      if (!r.ok) {
        let errMsg = 'فشل في رفع الملف';
        try {
          const body = await r.json();
          if (body?.error) errMsg = body.error;
        } catch { /* ignore parse error */ }
        throw new Error(errMsg);
      }

      const data: UploadResponse = await r.json();
      setProgress(100);
      options.onSuccess?.(data);
      return data;
    } catch (err) {
      const e = err instanceof Error ? err : new Error('حدث خطأ غير متوقع أثناء الرفع');
      setError(e);
      options.onError?.(e);
      return null;
    } finally {
      setIsUploading(false);
    }
  }, [options, maxMB]);

  return { uploadFile, isUploading, error, progress };
}
