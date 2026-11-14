import { initTheme } from './theme.ts';
import { initModals } from './modals.ts';
import { showToast } from './toast.ts';
import { auditCookies } from './cookies.ts';
import { auditVault } from './vault.ts';
import {
  resolveEffectivePages,
  splitPdf,
  splitIntoIndividualPdfs,
  mergePdfs,
  reorderAndRotatePdf,
  generateSamplePdf,
} from './pdf-engine.ts';

type LoadedPdf = {
  name: string;
  size: number;
  buffer: ArrayBuffer;
  pageCount: number;
};

type PageSpec = {
  pageIndex: number;
  rotationDegrees: number;
};

document.addEventListener('DOMContentLoaded', () => {
  initTheme();
  initModals();

  const audit = auditCookies();
  const vault = auditVault();
  console.log(`[OTHRYS] PDFSplit initialized. Cookies: ${audit.totalCookies}, Vault: ${vault.clientSideOnly}`);

  let currentPdfs: LoadedPdf[] = [];
  let pageSpecs: PageSpec[] = [];
  let activeTab: 'split' | 'merge' | 'reorder' = 'split';
  let activeObjectUrls: string[] = [];

  const fileInput = document.getElementById('file-upload') as HTMLInputElement | null;
  const dropZone = document.getElementById('drop-zone');
  const sampleBtn = document.getElementById('load-sample-pdf');
  const clearBtn = document.getElementById('action-clear');
  const fileSummary = document.getElementById('file-summary');
  const pageRangeInput = document.getElementById('page-range') as HTMLInputElement | null;
  const splitModeSelect = document.getElementById('split-mode') as HTMLSelectElement | null;
  const splitBtn = document.getElementById('action-split');
  const mergeBtn = document.getElementById('action-merge');
  const mergeList = document.getElementById('merge-list');
  const reorderGrid = document.getElementById('reorder-grid');
  const reorderBtn = document.getElementById('action-reorder');
  const resetOrderBtn = document.getElementById('action-reset-order');
  const outputRegion = document.getElementById('output-region');
  const tabSplit = document.getElementById('tab-split');
  const tabMerge = document.getElementById('tab-merge');
  const tabReorder = document.getElementById('tab-reorder');

  function revokeActiveUrls() {
    for (const url of activeObjectUrls) {
      URL.revokeObjectURL(url);
    }
    activeObjectUrls = [];
  }

  function createPdfUrl(bytes: Uint8Array): string {
    const copy = new Uint8Array(bytes);
    const blob = new Blob([copy], { type: 'application/pdf' });
    const url = URL.createObjectURL(blob);
    activeObjectUrls.push(url);
    return url;
  }

  function resetPageSpecsFromPrimary() {
    if (currentPdfs.length === 0) {
      pageSpecs = [];
      return;
    }
    const primary = currentPdfs[0];
    pageSpecs = Array.from({ length: primary.pageCount }, (_, idx) => ({
      pageIndex: idx,
      rotationDegrees: 0,
    }));
  }

  function setTab(next: 'split' | 'merge' | 'reorder') {
    activeTab = next;
    const tabs: [HTMLElement | null, 'split' | 'merge' | 'reorder'][] = [
      [tabSplit, 'split'],
      [tabMerge, 'merge'],
      [tabReorder, 'reorder'],
    ];
    for (const [el, key] of tabs) {
      if (!el) continue;
      const isSelected = key === next;
      el.classList.toggle('active', isSelected);
      el.setAttribute('aria-selected', String(isSelected));
    }

    const splitSection = document.getElementById('split-controls');
    const mergeSection = document.getElementById('merge-controls');
    const reorderSection = document.getElementById('reorder-controls');
    if (splitSection) splitSection.hidden = next !== 'split';
    if (mergeSection) mergeSection.hidden = next !== 'merge';
    if (reorderSection) reorderSection.hidden = next !== 'reorder';
  }

  tabSplit?.addEventListener('click', () => setTab('split'));
  tabMerge?.addEventListener('click', () => setTab('merge'));
  tabReorder?.addEventListener('click', () => setTab('reorder'));

  function renderAllViews() {
    updateFileSummary();
    renderMergeList();
    renderReorderGrid();
  }

  async function handleFiles(files: FileList | null) {
    if (!files || files.length === 0) return;

    const hadPrimary = currentPdfs.length > 0;
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      if (!file.name.toLowerCase().endsWith('.pdf') && file.type !== 'application/pdf') {
        showToast(`Skipped ${file.name} (not a PDF).`);
        continue;
      }

      try {
        const buffer = await file.arrayBuffer();
        const { PDFDocument } = await import('pdf-lib');
        const doc = await PDFDocument.load(buffer, { ignoreEncryption: true });
        currentPdfs.push({
          name: file.name,
          size: file.size,
          buffer,
          pageCount: doc.getPageCount(),
        });
      } catch (err) {
        showToast(`Failed to parse ${file.name}: ${(err as Error).message}`);
      }
    }

    if (!hadPrimary && currentPdfs.length > 0) {
      resetPageSpecsFromPrimary();
    }
    renderAllViews();
  }

  function updateFileSummary() {
    if (!fileSummary) return;

    if (currentPdfs.length === 0) {
      fileSummary.innerHTML = '<span class="text-muted">No files loaded yet.</span>';
      return;
    }

    const items = currentPdfs.map(
      (p, idx) =>
        `<div class="pdf-file-chip">
          <span class="file-name">${escapeHtml(p.name)}</span>
          <span class="file-meta">${p.pageCount} ${p.pageCount === 1 ? 'page' : 'pages'} (${(p.size / 1024).toFixed(1)} KB)</span>
          <button type="button" class="chip-remove" data-index="${idx}" aria-label="Remove ${escapeHtml(p.name)}">&times;</button>
        </div>`
    );

    fileSummary.innerHTML = `<div class="file-chip-grid">${items.join('')}</div>`;
    fileSummary.querySelectorAll('.chip-remove').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        const idx = parseInt((e.currentTarget as HTMLElement).getAttribute('data-index') || '-1', 10);
        if (idx >= 0 && idx < currentPdfs.length) {
          currentPdfs.splice(idx, 1);
          if (idx === 0) {
            resetPageSpecsFromPrimary();
          }
          renderAllViews();
          showToast('File removed.');
        }
      });
    });
  }

  function renderMergeList() {
    if (!mergeList) return;
    if (currentPdfs.length === 0) {
      mergeList.innerHTML = '<span class="text-muted">Load 2 or more PDF files above to arrange merge order.</span>';
      return;
    }

    mergeList.innerHTML = currentPdfs
      .map(
        (p, idx) => `
      <div class="merge-row">
        <div class="merge-row-info">
          <span class="merge-index">#${idx + 1}</span>
          <span class="file-name">${escapeHtml(p.name)}</span>
          <span class="file-meta">(${p.pageCount} ${p.pageCount === 1 ? 'page' : 'pages'})</span>
        </div>
        <div class="row-controls">
          <button type="button" class="btn btn-secondary btn-sm" data-merge-action="up" data-index="${idx}" ${idx === 0 ? 'disabled' : ''}>Up</button>
          <button type="button" class="btn btn-secondary btn-sm" data-merge-action="down" data-index="${idx}" ${idx === currentPdfs.length - 1 ? 'disabled' : ''}>Down</button>
          <button type="button" class="btn btn-secondary btn-sm" data-merge-action="remove" data-index="${idx}">Remove</button>
        </div>
      </div>
    `
      )
      .join('');

    mergeList.querySelectorAll<HTMLButtonElement>('[data-merge-action]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const action = btn.getAttribute('data-merge-action');
        const idx = parseInt(btn.getAttribute('data-index') || '-1', 10);
        if (idx < 0 || idx >= currentPdfs.length) return;

        if (action === 'up' && idx > 0) {
          [currentPdfs[idx - 1], currentPdfs[idx]] = [currentPdfs[idx], currentPdfs[idx - 1]];
        } else if (action === 'down' && idx < currentPdfs.length - 1) {
          [currentPdfs[idx], currentPdfs[idx + 1]] = [currentPdfs[idx + 1], currentPdfs[idx]];
        } else if (action === 'remove') {
          currentPdfs.splice(idx, 1);
        }
        resetPageSpecsFromPrimary();
        renderAllViews();
      });
    });
  }

  function renderReorderGrid() {
    if (!reorderGrid) return;
    if (currentPdfs.length === 0) {
      reorderGrid.innerHTML = '<span class="text-muted">Load a PDF file above to reorder or rotate its pages.</span>';
      return;
    }

    if (pageSpecs.length === 0) {
      reorderGrid.innerHTML = '<span class="text-muted">All pages were removed. Click "Reset Original Pages" to restore them.</span>';
      return;
    }

    const primary = currentPdfs[0];
    reorderGrid.innerHTML = pageSpecs
      .map(
        (spec, pos) => `
      <div class="page-card">
        <div class="page-card-head">
          <span class="page-badge">Page ${spec.pageIndex + 1}</span>
          <span class="rotation-pill">${spec.rotationDegrees}&deg;</span>
        </div>
        <small class="text-muted">Position ${pos + 1} of ${pageSpecs.length} &middot; ${escapeHtml(primary.name)}</small>
        <div class="page-card-actions">
          <button type="button" class="btn btn-secondary btn-sm" data-page-action="left" data-pos="${pos}" ${pos === 0 ? 'disabled' : ''}>&larr; Left</button>
          <button type="button" class="btn btn-secondary btn-sm" data-page-action="right" data-pos="${pos}" ${pos === pageSpecs.length - 1 ? 'disabled' : ''}>Right &rarr;</button>
          <button type="button" class="btn btn-secondary btn-sm" data-page-action="rotate" data-pos="${pos}">&#x21BB; 90&deg;</button>
          <button type="button" class="btn btn-secondary btn-sm" data-page-action="remove" data-pos="${pos}">Remove</button>
        </div>
      </div>
    `
      )
      .join('');

    reorderGrid.querySelectorAll<HTMLButtonElement>('[data-page-action]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const action = btn.getAttribute('data-page-action');
        const pos = parseInt(btn.getAttribute('data-pos') || '-1', 10);
        if (pos < 0 || pos >= pageSpecs.length) return;

        if (action === 'left' && pos > 0) {
          [pageSpecs[pos - 1], pageSpecs[pos]] = [pageSpecs[pos], pageSpecs[pos - 1]];
        } else if (action === 'right' && pos < pageSpecs.length - 1) {
          [pageSpecs[pos], pageSpecs[pos + 1]] = [pageSpecs[pos + 1], pageSpecs[pos]];
        } else if (action === 'rotate') {
          pageSpecs[pos].rotationDegrees = (pageSpecs[pos].rotationDegrees + 90) % 360;
        } else if (action === 'remove') {
          pageSpecs.splice(pos, 1);
        }
        renderReorderGrid();
      });
    });
  }

  if (fileInput) {
    fileInput.addEventListener('change', () => {
      handleFiles(fileInput.files);
      fileInput.value = '';
    });
  }

  if (dropZone) {
    dropZone.addEventListener('dragover', (e) => {
      e.preventDefault();
      dropZone.classList.add('drag-over');
    });
    dropZone.addEventListener('dragleave', () => {
      dropZone.classList.remove('drag-over');
    });
    dropZone.addEventListener('drop', (e) => {
      e.preventDefault();
      dropZone.classList.remove('drag-over');
      handleFiles(e.dataTransfer?.files || null);
    });
    dropZone.addEventListener('click', () => {
      fileInput?.click();
    });
    dropZone.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        fileInput?.click();
      }
    });
  }

  // Load 4-page client sample PDF
  if (sampleBtn) {
    sampleBtn.addEventListener('click', async () => {
      sampleBtn.setAttribute('disabled', 'true');
      try {
        const bytes = await generateSamplePdf();
        const copy = new Uint8Array(bytes);
        const buffer = copy.buffer.slice(copy.byteOffset, copy.byteOffset + copy.byteLength);
        currentPdfs.push({
          name: `sample_sovereign_${currentPdfs.length + 1}.pdf`,
          size: bytes.byteLength,
          buffer,
          pageCount: 4,
        });
        if (currentPdfs.length === 1) {
          resetPageSpecsFromPrimary();
        }
        renderAllViews();
        showToast('Loaded 4-page sample PDF into RAM.');
      } catch (err) {
        showToast(`Failed to generate sample PDF: ${(err as Error).message}`);
      } finally {
        sampleBtn.removeAttribute('disabled');
      }
    });
  }

  // Split Action
  if (splitBtn && pageRangeInput && outputRegion) {
    splitBtn.addEventListener('click', async () => {
      if (currentPdfs.length === 0) {
        showToast('Please load a PDF file first.');
        return;
      }

      const activePdf = currentPdfs[0];
      const rangeVal = pageRangeInput.value.trim();
      const pages = resolveEffectivePages(rangeVal, activePdf.pageCount);
      if (pages.length === 0) {
        showToast(`Please enter valid page numbers (1 to ${activePdf.pageCount}).`);
        return;
      }

      const mode = splitModeSelect?.value === 'separate' ? 'separate' : 'single';
      splitBtn.setAttribute('disabled', 'true');
      splitBtn.textContent = 'Splitting in RAM...';

      try {
        revokeActiveUrls();
        const baseName = activePdf.name.replace(/\.pdf$/i, '');

        if (mode === 'separate') {
          const outputs = await splitIntoIndividualPdfs(activePdf.buffer, pages);
          const rows = outputs
            .map((item) => {
              const url = createPdfUrl(item.bytes);
              const outName = `${baseName}_page_${item.pageNumber}.pdf`;
              return `
                <div class="result-list-item">
                  <span><strong>Page ${item.pageNumber}</strong> (${(item.bytes.byteLength / 1024).toFixed(1)} KB)</span>
                  <div class="result-actions">
                    <a href="${url}" download="${escapeHtml(outName)}" class="btn btn-primary btn-sm">Download</a>
                    <a href="${url}" target="_blank" rel="noopener noreferrer" class="btn btn-secondary btn-sm">Preview PDF ↗</a>
                  </div>
                </div>
              `;
            })
            .join('');

          outputRegion.innerHTML = `
            <div class="result-card">
              <h4>Split into ${outputs.length} Single-Page PDF${outputs.length === 1 ? '' : 's'}</h4>
              <p>Generated strictly in volatile browser memory.</p>
              <div class="result-list">${rows}</div>
            </div>
          `;
        } else {
          const outBytes = await splitPdf(activePdf.buffer, pages);
          const url = createPdfUrl(outBytes);
          const outName = `${baseName}_split_pages_${pages.join('_')}.pdf`;

          outputRegion.innerHTML = `
            <div class="result-card">
              <h4>Extracted PDF Ready (${pages.length} ${pages.length === 1 ? 'page' : 'pages'})</h4>
              <p>Generated strictly in volatile browser memory.</p>
              <div class="result-actions">
                <a href="${url}" download="${escapeHtml(outName)}" class="btn btn-primary">Download ${escapeHtml(outName)}</a>
                <a href="${url}" target="_blank" rel="noopener noreferrer" class="btn btn-secondary">Preview PDF ↗</a>
              </div>
            </div>
          `;
        }
        showToast('Split completed in RAM.');
      } catch (err) {
        showToast(`Split failed: ${(err as Error).message}`);
      } finally {
        splitBtn.removeAttribute('disabled');
        splitBtn.textContent = 'Split PDF';
      }
    });
  }

  // Merge Action
  if (mergeBtn && outputRegion) {
    mergeBtn.addEventListener('click', async () => {
      if (currentPdfs.length < 2) {
        showToast('Please load at least 2 PDF files to merge.');
        return;
      }

      mergeBtn.setAttribute('disabled', 'true');
      mergeBtn.textContent = 'Merging in RAM...';

      try {
        revokeActiveUrls();
        const buffers = currentPdfs.map((p) => p.buffer);
        const outBytes = await mergePdfs(buffers);
        const url = createPdfUrl(outBytes);
        const totalPages = currentPdfs.reduce((acc, p) => acc + p.pageCount, 0);

        outputRegion.innerHTML = `
          <div class="result-card">
            <h4>Merged PDF Ready (${totalPages} pages from ${currentPdfs.length} files)</h4>
            <p>Compiled strictly in volatile browser memory.</p>
            <div class="result-actions">
              <a href="${url}" download="merged_sovereign_document.pdf" class="btn btn-primary">Download Merged PDF</a>
              <a href="${url}" target="_blank" rel="noopener noreferrer" class="btn btn-secondary">Preview PDF ↗</a>
            </div>
          </div>
        `;
        showToast('Merge completed in RAM.');
      } catch (err) {
        showToast(`Merge failed: ${(err as Error).message}`);
      } finally {
        mergeBtn.removeAttribute('disabled');
        mergeBtn.textContent = 'Merge All PDFs';
      }
    });
  }

  // Reorder & Rotate Action
  if (reorderBtn && outputRegion) {
    reorderBtn.addEventListener('click', async () => {
      if (currentPdfs.length === 0) {
        showToast('Please load a PDF file first.');
        return;
      }
      if (pageSpecs.length === 0) {
        showToast('No pages remain to export.');
        return;
      }

      reorderBtn.setAttribute('disabled', 'true');
      reorderBtn.textContent = 'Rebuilding in RAM...';

      try {
        revokeActiveUrls();
        const activePdf = currentPdfs[0];
        const outBytes = await reorderAndRotatePdf(activePdf.buffer, pageSpecs);
        const url = createPdfUrl(outBytes);
        const outName = `${activePdf.name.replace(/\.pdf$/i, '')}_reordered.pdf`;

        outputRegion.innerHTML = `
          <div class="result-card">
            <h4>Reordered PDF Ready (${pageSpecs.length} ${pageSpecs.length === 1 ? 'page' : 'pages'})</h4>
            <p>Compiled strictly in volatile browser memory.</p>
            <div class="result-actions">
              <a href="${url}" download="${escapeHtml(outName)}" class="btn btn-primary">Download ${escapeHtml(outName)}</a>
              <a href="${url}" target="_blank" rel="noopener noreferrer" class="btn btn-secondary">Preview PDF ↗</a>
            </div>
          </div>
        `;
        showToast('Reordered PDF exported.');
      } catch (err) {
        showToast(`Export failed: ${(err as Error).message}`);
      } finally {
        reorderBtn.removeAttribute('disabled');
        reorderBtn.textContent = 'Export Reordered PDF';
      }
    });
  }

  resetOrderBtn?.addEventListener('click', () => {
    resetPageSpecsFromPrimary();
    renderReorderGrid();
    showToast('Restored original page order and orientation.');
  });

  // Single Clear Action
  if (clearBtn && pageRangeInput && outputRegion) {
    clearBtn.addEventListener('click', () => {
      revokeActiveUrls();
      currentPdfs = [];
      pageSpecs = [];
      pageRangeInput.value = '';
      renderAllViews();
      outputRegion.innerHTML = '<div class="output-placeholder">Output results will appear here once you run an operation.</div>';
      showToast('Cleared workspace.');
    });
  }

  setTab('split');
  renderAllViews();
});

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
