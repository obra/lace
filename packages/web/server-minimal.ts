// ABOUTME: Minimal production server for debugging Bun executable
// ABOUTME: Just outputs one line to verify basic functionality

// import express from 'express';
// import { createRequestHandler } from '@react-router/express';
console.log('🧪 Starting minimal production server...');

//try {
//if (typeof Bun !== 'undefined' && Bun.embeddedFiles) {
  console.log(`✅ Found ${Bun.embeddedFiles.length} embedded files`);
  
  // Show catalog files
//  const catalogs = Array.from(Bun.embeddedFiles).filter(f => f.name.includes('providers/catalog/data') && f.name.endsWith('.json'));
  console.log(`📋 Provider catalogs: ${catalogs.length}`);
 // catalogs.forEach(f => console.log(`   ${f.name}`));
//} else {
  console.log('❌ No Bun.embeddedFiles found');
//} 
//} catch (e) {
console.log("Error e "+e);
//}
// Start minimal Express server
// const app = express();
// const serverBuild = await import('./build/server/index.js');

//  app.use(createRequestHandler({
//    build: () => ({}), //  serverBuild,
//    getLoadContext: () => ({})
//  }));
  
//const port = 31337;

// try {
// app.listen(port, 'localhost', () => {
//   console.log(`✅ Server ready on http://localhost:${port}`);
//   console.log(`LACE_SERVER_PORT:${port}`);
//   console.log(`LACE_SERVER_URL:http://localhost:${port}`);
// });
// } catch (e) {
// 	console.log("EEE "+e);
// }
