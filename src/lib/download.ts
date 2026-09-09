/** Hands a generated Blob to the browser as a file save. The temporary <a download> has to be in the
 *  document for the click to count as user-initiated in every browser, and the object URL is revoked
 *  on a timer rather than immediately after the click because some browsers only start reading the
 *  blob after the current task yields - revoking synchronously can cancel the download that just
 *  started. A null blob (what canvas.toBlob() hands back when encoding fails) is a no-op, so callers
 *  can pass a toBlob() result straight through. */
export function downloadBlob(blob: Blob | null, filename: string): void {
  if (!blob) return;
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
