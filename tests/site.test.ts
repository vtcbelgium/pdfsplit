import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('PDFSplit Sovereign & SEO Security Contract', () => {
  let html: string;

  beforeEach(() => {
    html = readFileSync(resolve(__dirname, '../index.html'), 'utf-8');
  });

  it('has strict Content-Security-Policy with no external script sources or inline onclick handlers', () => {
    expect(html).toContain('http-equiv="Content-Security-Policy"');
    expect(html).toContain("script-src 'self'");
    expect(html).toContain("connect-src 'self'");
    expect(html).not.toContain('https://www.google-analytics.com');
    expect(html).not.toContain('https://googletagmanager.com');
    expect(html).not.toMatch(/\bonclick=/i);
  });

  it('enforces unique element id attributes across index.html', () => {
    const ids = Array.from(html.matchAll(/\bid="([^"]+)"/g)).map((m) => m[1]);
    expect(ids.length).toBeGreaterThan(10);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('declares WebApplication, FAQPage, and Organization provenance JSON-LD with zero Person entities', () => {
    expect(html).toContain('https://schema.org');
    expect(html).toContain('"@type": "WebApplication"');
    expect(html).toContain('"@type": "FAQPage"');
    expect(html).toContain('"@type": "Organization"');
    expect(html).toContain('"publishingPrinciples": "https://othrys.be/legal/security"');
    expect(html).toContain('https://pdfsplit.othrys.be/');
    expect(html).not.toMatch(/"@type"\s*:\s*"Person"/i);
    expect(html).toContain('id="methodology-provenance"');
  });

  it('includes all 4 Sovereign Fleet dialogs', () => {
    expect(html).toContain('id="about-dialog"');
    expect(html).toContain('id="settings-dialog"');
    expect(html).toContain('id="vault-dialog"');
    expect(html).toContain('id="cookie-dialog"');
  });

  it('contains the Sovereign Fleet sitemap grid footer', () => {
    expect(html).toContain('sovereign-footer');
    expect(html).toContain('https://othrys.be');
    expect(html).toContain('https://wordcounter.othrys.be');
    expect(html).toContain('https://jsonfix.othrys.be');
  });
});
