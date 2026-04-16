import ExcelJS from 'exceljs';
import jsPDF from 'jspdf';
import html2canvas from 'html2canvas';
import api from '../services/api';

// ─── Status translation ───────────────────────────────────────────────────────
const STATUS_LABELS: Record<string, { ar: string; en: string }> = {
  OK:             { ar: 'منتظم',      en: 'On Track'  },
  WARN:           { ar: 'تنبيه',      en: 'Warning'   },
  OVERDUE:        { ar: 'متأخر',      en: 'Overdue'   },
  COMPLETED:      { ar: 'منجز',       en: 'Done'      },
  COMPLETED_LATE: { ar: 'منجز متأخر', en: 'Late Done' },
  CANCELLED:      { ar: 'ملغى',       en: 'Cancelled' },
  CLOSED:         { ar: 'مغلق',       en: 'Closed'    },
  EXECUTED:       { ar: 'تم التنفيذ', en: 'Executed'  },
  ONGOING:        { ar: 'قائم',       en: 'Ongoing'   },
  NONE:           { ar: '—',          en: '—'         },
};

export interface ReportColumn {
  key: string;
  labelAr: string;
  labelEn?: string;
}

export interface ExportOptions {
  data: any[];
  columns: ReportColumn[];
  lang: 'ar' | 'en';
  filters?: {
    regionName?: string;
    sectorName?: string;
  };
  username?: string;
  format: 'excel' | 'pdf';
  filename: string;
  sheetTitle?: string;
}

interface ReportHeader {
  logoRightUrl:        string | null;
  logoLeftUrl:         string | null;
  companyNameAr:       string | null;
  companyNameEn:       string | null;
  logoRightWidthExcel: number;
  logoLeftWidthExcel:  number;
  logoRightWidthPdf:   number;
  logoLeftWidthPdf:    number;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
async function fetchReportHeader(): Promise<ReportHeader> {
  try {
    const r = await api.get('/admin/report-header');
    const d = r.data;
    return {
      logoRightUrl:        d.logoRightUrl        ?? null,
      logoLeftUrl:         d.logoLeftUrl         ?? null,
      companyNameAr:       d.companyNameAr       ?? null,
      companyNameEn:       d.companyNameEn       ?? null,
      logoRightWidthExcel: d.logoRightWidthExcel ?? 150,
      logoLeftWidthExcel:  d.logoLeftWidthExcel  ?? 150,
      logoRightWidthPdf:   d.logoRightWidthPdf   ?? 150,
      logoLeftWidthPdf:    d.logoLeftWidthPdf    ?? 150,
    };
  } catch {
    return {
      logoRightUrl: null, logoLeftUrl: null,
      companyNameAr: null, companyNameEn: null,
      logoRightWidthExcel: 150, logoLeftWidthExcel: 150,
      logoRightWidthPdf: 150, logoLeftWidthPdf: 150,
    };
  }
}

interface ImageData {
  dataUrl:       string;
  base64:        string;
  mimeType:      string;
  ext:           'png' | 'jpeg' | 'gif';
  naturalWidth:  number;
  naturalHeight: number;
}

// Convert any image dataUrl → PNG, preserving original width×height
async function dataUrlToPng(src: string): Promise<{ dataUrl: string; w: number; h: number }> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      const w = img.naturalWidth  || 300;
      const h = img.naturalHeight || 300;
      const canvas = document.createElement('canvas');
      canvas.width  = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d')!;
      ctx.clearRect(0, 0, w, h);
      ctx.drawImage(img, 0, 0, w, h);
      resolve({ dataUrl: canvas.toDataURL('image/png'), w, h });
    };
    img.onerror = reject;
    img.src = src;
  });
}

// Get natural dimensions from a dataUrl (for JPEG/PNG that don't go through canvas)
async function getImageDims(src: string): Promise<{ w: number; h: number }> {
  return new Promise(resolve => {
    const img = new Image();
    img.onload = () => resolve({ w: img.naturalWidth || 0, h: img.naturalHeight || 0 });
    img.onerror = () => resolve({ w: 0, h: 0 });
    img.src = src;
  });
}

async function fetchImage(url: string): Promise<ImageData | null> {
  try {
    const fullUrl = url.startsWith('http') ? url : `${window.location.origin}${url}`;
    const res  = await fetch(fullUrl, { credentials: 'same-origin' });
    if (!res.ok) {
      console.warn('[reportExporter] fetch failed:', res.status, url);
      return null;
    }
    const blob = await res.blob();

    let dataUrl: string = await new Promise((resolve, reject) => {
      const reader     = new FileReader();
      reader.onloadend = () => resolve(reader.result as string);
      reader.onerror   = reject;
      reader.readAsDataURL(blob);
    });

    let mimeType = blob.type || 'image/png';
    let naturalWidth  = 0;
    let naturalHeight = 0;

    // Convert SVG / WEBP → PNG (ExcelJS needs raster), preserving true dimensions
    if (mimeType.includes('svg') || mimeType.includes('webp')) {
      try {
        const r = await dataUrlToPng(dataUrl);
        dataUrl       = r.dataUrl;
        naturalWidth  = r.w;
        naturalHeight = r.h;
        mimeType      = 'image/png';
      } catch (e) {
        console.warn('[reportExporter] SVG/WEBP→PNG conversion failed:', e);
        return null;
      }
    } else {
      const dims    = await getImageDims(dataUrl);
      naturalWidth  = dims.w;
      naturalHeight = dims.h;
    }

    const comma = dataUrl.indexOf(',');
    if (comma === -1) return null;
    const base64 = dataUrl.slice(comma + 1);

    let ext: 'png' | 'jpeg' | 'gif' = 'png';
    if (mimeType.includes('jpeg') || mimeType.includes('jpg')) ext = 'jpeg';
    else if (mimeType.includes('gif')) ext = 'gif';

    return { dataUrl, base64, mimeType, ext, naturalWidth, naturalHeight };
  } catch (e) {
    console.warn('[reportExporter] fetchImage error:', e);
    return null;
  }
}

export function formatExportValue(v: any, lang: 'ar' | 'en'): string {
  if (v === null || v === undefined || v === '') return '';
  const str = String(v);
  const status = STATUS_LABELS[str];
  if (status) return lang === 'ar' ? status.ar : status.en;
  if (v === true  || str === 'true')  return lang === 'ar' ? 'نعم' : 'Yes';
  if (v === false || str === 'false') return lang === 'ar' ? 'لا'  : 'No';
  if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v)) {
    try {
      const d = new Date(v);
      if (!isNaN(d.getTime())) {
        return lang === 'ar'
          ? d.toLocaleDateString('ar-EG', { year: 'numeric', month: '2-digit', day: '2-digit' })
          : d.toLocaleDateString('en-CA');
      }
    } catch { /* fall through */ }
  }
  return str;
}

function colLabel(col: ReportColumn, lang: 'ar' | 'en'): string {
  return lang === 'en' && col.labelEn ? col.labelEn : col.labelAr;
}

function nowDateStr(lang: 'ar' | 'en'): string {
  const d = new Date();
  return lang === 'ar'
    ? d.toLocaleDateString('ar-EG', { year: 'numeric', month: '2-digit', day: '2-digit' })
    : d.toLocaleDateString('en-CA');
}

// ─── Excel export ─────────────────────────────────────────────────────────────
async function exportExcel(opts: ExportOptions, hdr: ReportHeader): Promise<void> {
  const { data, columns, lang, filters, username, filename, sheetTitle } = opts;
  const isAr = lang === 'ar';
  const nc   = Math.max(columns.length, 4);

  const wb = new ExcelJS.Workbook();
  wb.creator = username ?? 'System';
  wb.created = new Date();

  const ws = wb.addWorksheet(sheetTitle ?? (isAr ? 'تقرير' : 'Report'), {
    views: [{ rightToLeft: isAr }],
  });

  // ── Header rows 1-5 ────────────────────────────────────────────────────────
  const LOGO_COLS = 2;
  const midS = LOGO_COLS + 1;
  const midE = nc - LOGO_COLS;

  for (let r = 1; r <= 5; r++) {
    const row = ws.getRow(r);
    for (let c = 1; c <= nc; c++) row.getCell(c).value = '';
    row.height = 20;
  }

  const midOk = midE >= midS;

  const setCenter = (rowNum: number, text: string, bold: boolean, size: number, color: string) => {
    if (!midOk) return;
    ws.mergeCells(rowNum, midS, rowNum, midE);
    const c = ws.getCell(rowNum, midS);
    c.value = text;
    c.font  = { bold, size, color: { argb: color } };
    c.alignment = { horizontal: 'center', vertical: 'middle' };
  };

  const regionValue = filters?.regionName ?? (isAr ? 'جميع المناطق' : 'All Regions');
  let rowPtr = 1;
  setCenter(rowPtr++, `${isAr ? 'المنطقة:' : 'Region:'} ${regionValue}`, false, 11, 'FF334155');
  if (filters?.sectorName) setCenter(rowPtr++, `${isAr ? 'القطاع:' : 'Sector:'} ${filters.sectorName}`, false, 10, 'FF64748b');
  if (username)            setCenter(rowPtr++, `${isAr ? 'مصدر التقرير:' : 'Report By:'} ${username}`, false, 10, 'FF64748b');
  setCenter(rowPtr++, `${isAr ? 'التاريخ:' : 'Date:'} ${nowDateStr(lang)}`, false, 10, 'FF64748b');

  // ── Logo images — FileReader/Blob + aspect-ratio height ─────────────────
  const addLogo = async (url: string | null, colZeroIdx: number, widthPx: number) => {
    if (!url) return;
    try {
      const img = await fetchImage(url);
      if (!img) {
        console.warn('[reportExporter] logo skipped (fetch failed):', url);
        return;
      }
      // Calculate height preserving natural aspect ratio
      const aspect  = img.naturalWidth > 0 && img.naturalHeight > 0
        ? img.naturalHeight / img.naturalWidth : 1;
      const heightPx = Math.round(widthPx * aspect);

      const imgId = wb.addImage({ base64: img.base64, extension: img.ext });
      ws.addImage(imgId, {
        tl: { col: colZeroIdx, row: 0 } as any,
        ext: { width: widthPx, height: heightPx },
        editAs: 'oneCell',
      });
    } catch (e) {
      console.warn('[reportExporter] logo embed failed:', e);
    }
  };

  // LEFT logo → column 0 (left edge), RIGHT logo → last columns (right edge)
  await addLogo(hdr.logoLeftUrl,  0,              hdr.logoLeftWidthExcel);
  await addLogo(hdr.logoRightUrl, nc - LOGO_COLS, hdr.logoRightWidthExcel);

  // ── Row 6: spacer ──────────────────────────────────────────────────────────
  ws.getRow(6).height = 6;

  // ── Row 7: column headers ──────────────────────────────────────────────────
  const HR  = ws.getRow(7);
  HR.height = 22;
  columns.forEach((col, i) => {
    const cell = HR.getCell(i + 1);
    cell.value = colLabel(col, lang);
    cell.font  = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 };
    cell.fill  = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1e3a5f' } };
    cell.alignment = { horizontal: 'center', vertical: 'middle' };
    cell.border = {
      top:    { style: 'thin', color: { argb: 'FFFFFFFF' } },
      left:   { style: 'thin', color: { argb: 'FFFFFFFF' } },
      bottom: { style: 'thin', color: { argb: 'FFFFFFFF' } },
      right:  { style: 'thin', color: { argb: 'FFFFFFFF' } },
    };
  });

  // ── Rows 8+: data ──────────────────────────────────────────────────────────
  const bdrStyle: Partial<ExcelJS.Border> = { style: 'thin', color: { argb: 'FFcbd5e1' } };
  const allBdr = { top: bdrStyle, left: bdrStyle, bottom: bdrStyle, right: bdrStyle };

  data.forEach((rowData, ri) => {
    const row = ws.getRow(8 + ri);
    row.height = 17;
    columns.forEach((col, ci) => {
      const cell = row.getCell(ci + 1);
      cell.value     = formatExportValue(rowData[col.key], lang);
      cell.alignment = { horizontal: isAr ? 'right' : 'left', vertical: 'middle' };
      cell.fill      = { type: 'pattern', pattern: 'solid', fgColor: { argb: ri % 2 === 0 ? 'FFF8FAFC' : 'FFFFFFFF' } };
      cell.border    = allBdr as ExcelJS.Borders;
    });
  });

  // ── Column widths ──────────────────────────────────────────────────────────
  ws.columns = columns.map(col => {
    const lbl    = colLabel(col, lang);
    const maxLen = Math.max(
      lbl.length + 4,
      ...data.slice(0, 300).map(r => formatExportValue(r[col.key], lang).length),
    );
    return { width: Math.min(Math.max(maxLen, 12), 42) };
  });

  // ── Download ───────────────────────────────────────────────────────────────
  const buf = await wb.xlsx.writeBuffer();
  const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const a = Object.assign(document.createElement('a'), {
    href: URL.createObjectURL(blob),
    download: filename,
  });
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
}

// ─── PDF export ───────────────────────────────────────────────────────────────
async function exportPdf(opts: ExportOptions, hdr: ReportHeader): Promise<void> {
  const { data, columns, lang, filters, username, filename } = opts;
  const isAr = lang === 'ar';
  const dir  = isAr ? 'rtl' : 'ltr';

  const [imgRight, imgLeft] = await Promise.all([
    hdr.logoRightUrl ? fetchImage(hdr.logoRightUrl) : Promise.resolve(null),
    hdr.logoLeftUrl  ? fetchImage(hdr.logoLeftUrl)  : Promise.resolve(null),
  ]);

  const regionValue = filters?.regionName ?? (isAr ? 'جميع المناطق' : 'All Regions');
  const rw = hdr.logoRightWidthPdf;
  const lw = hdr.logoLeftWidthPdf;

  // Always: LEFT logo on LEFT side, RIGHT logo on RIGHT side
  // We render in LTR HTML so slot1 (first in DOM) = left, slot2 (last in DOM) = right
  const slot1Img = imgLeft;   // left logo → left side
  const slot2Img = imgRight;  // right logo → right side
  const slot1W   = lw;
  const slot2W   = rw;

  const CONTENT_W = 1400;

  // Calculate img display height from natural aspect ratio
  const logoImgStyle = (img: typeof imgLeft, w: number) => {
    const aspect = img && img.naturalWidth > 0 && img.naturalHeight > 0
      ? img.naturalHeight / img.naturalWidth : 1;
    const h = Math.round(w * aspect);
    return `width:${w}px;height:${h}px;object-fit:contain;display:block;flex-shrink:0`;
  };

  const logoDiv = (img: typeof imgLeft, w: number) =>
    img
      ? `<div style="width:${w}px;min-width:${w}px;display:flex;align-items:center;justify-content:center;padding:4px 8px;">
           <img src="${img.dataUrl}" style="${logoImgStyle(img, w)}" />
         </div>`
      : `<div style="width:${w}px;min-width:${w}px;"></div>`;

  const tdStyle = `padding:5px 8px;font-size:9.5px;color:#1e293b;border:1px solid #e2e8f0;`;
  const thCells = columns.map(col =>
    `<th style="background:#1e3a5f;color:#fff;padding:7px 8px;font-size:10px;font-weight:bold;`
    + `text-align:${isAr ? 'right' : 'left'};border:1px solid #fff;white-space:nowrap;">`
    + `${colLabel(col, lang)}</th>`
  ).join('');

  const trRows = data.map((row, ri) =>
    `<tr>${columns.map(col => {
      const val = formatExportValue(row[col.key], lang) || '—';
      const bg  = ri % 2 === 0 ? '#f8fafc' : '#fff';
      return `<td style="${tdStyle}background:${bg};text-align:${isAr ? 'right' : 'left'}">${val}</td>`;
    }).join('')}</tr>`
  ).join('');

  // Always render in LTR to avoid html2canvas RTL clipping — text direction applied per-element
  const html = `
    <div style="font-family:Arial,'Noto Naskh Arabic',Tahoma,sans-serif;direction:ltr;background:#fff;width:${CONTENT_W}px;overflow:visible;">
      <div style="display:flex;flex-direction:row;align-items:center;justify-content:space-between;
                  padding:10px 8px;background:#f8fafc;border-bottom:3px solid #1e3a5f;
                  width:${CONTENT_W}px;box-sizing:border-box;overflow:visible;">
        ${logoDiv(slot1Img, slot1W)}
        <div style="flex:1;min-width:0;text-align:center;padding:0 12px;direction:${dir}">
          <div style="font-size:11px;color:#334155;margin:2px 0">${isAr ? 'المنطقة:' : 'Region:'} <b>${regionValue}</b></div>
          ${filters?.sectorName ? `<div style="font-size:11px;color:#334155;margin:2px 0">${isAr ? 'القطاع:' : 'Sector:'} <b>${filters.sectorName}</b></div>` : ''}
          ${username ? `<div style="font-size:10px;color:#64748b;margin:2px 0">${isAr ? 'مصدر التقرير:' : 'Report By:'} ${username}</div>` : ''}
          <div style="font-size:10px;color:#64748b;margin:2px 0">${isAr ? 'التاريخ:' : 'Date:'} ${nowDateStr(lang)}</div>
        </div>
        ${logoDiv(slot2Img, slot2W)}
      </div>
      <div style="direction:${dir}">
        <table style="width:100%;border-collapse:collapse;direction:${dir}">
          <thead><tr>${thCells}</tr></thead>
          <tbody>${trRows}</tbody>
        </table>
      </div>
    </div>
  `;

  // Use position:absolute at a large negative top offset — avoids fixed-positioning clipping
  const wrap = document.createElement('div');
  wrap.style.cssText = `position:absolute;left:0;top:-99999px;width:${CONTENT_W}px;overflow:visible;z-index:-9999;`;
  wrap.innerHTML = html;
  document.body.appendChild(wrap);

  try {
    const el     = wrap.firstElementChild as HTMLElement;
    const canvas = await html2canvas(el, {
      scale:           1.5,
      useCORS:         true,
      backgroundColor: '#ffffff',
      logging:         false,
      width:           CONTENT_W,
      windowWidth:     CONTENT_W,
    });

    const imgData = canvas.toDataURL('image/jpeg', 0.92);
    const pdf     = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
    const pageW   = pdf.internal.pageSize.getWidth();
    const pageH   = pdf.internal.pageSize.getHeight();
    const imgH    = (canvas.height * pageW) / canvas.width;

    if (imgH <= pageH) {
      pdf.addImage(imgData, 'JPEG', 0, 0, pageW, imgH);
    } else {
      let heightLeft = imgH;
      let pos        = 0;
      pdf.addImage(imgData, 'JPEG', 0, pos, pageW, imgH);
      heightLeft -= pageH;
      while (heightLeft > 0) {
        pos -= pageH;
        pdf.addPage();
        pdf.addImage(imgData, 'JPEG', 0, pos, pageW, imgH);
        heightLeft -= pageH;
      }
    }

    pdf.save(filename);
  } finally {
    document.body.removeChild(wrap);
  }
}

// ─── Public entry point ───────────────────────────────────────────────────────
export async function exportReport(opts: ExportOptions): Promise<void> {
  const hdr = await fetchReportHeader();
  if (opts.format === 'excel') {
    await exportExcel(opts, hdr);
  } else {
    await exportPdf(opts, hdr);
  }
}
