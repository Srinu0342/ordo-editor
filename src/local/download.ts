// Save text as a file through the browser's own download, with no server in
// between: View Ordo YAML's Download, and a conflict's "Download mine".

export function download(text: string, fileName: string) {
  const url = URL.createObjectURL(new Blob([text], { type: "application/yaml" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.style.display = "none";
  document.body.append(link);
  link.click();
  link.remove();
  // Revoked a moment later rather than at once: some browsers start reading
  // the blob only after click() returns.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
