// Check what properties Bun.embeddedFiles actually have
console.log('Testing Bun.embeddedFiles properties...');

if (typeof Bun !== 'undefined' && Bun.embeddedFiles && Bun.embeddedFiles.length > 0) {
  const file = Bun.embeddedFiles[0];
  console.log('First embedded file:');
  console.log('  typeof file:', typeof file);
  console.log('  instanceof Blob:', file instanceof Blob);
  console.log('  Object.keys(file):', Object.keys(file));
  console.log('  file.name:', (file as any).name);
  console.log('  file.size:', file.size);
  console.log('  file.type:', file.type);
  console.log('  has text():', typeof file.text === 'function');
} else {
  console.log('No embedded files available');
}