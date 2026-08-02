const { exec } = require('pkg');
const path = require('path');
const fs = require('fs');

async function buildExecutable() {
  console.log('========================================================');
  console.log('📦 Packaging PrintAgent.exe for Windows 64-bit (win-x64)...');
  console.log('========================================================');

  const outputDir = path.join(__dirname, 'dist');
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const entryFile = path.join(__dirname, 'src', 'agent.js');
  const outputFile = path.join(outputDir, 'PrintAgent.exe');

  try {
    await exec([
      entryFile,
      '--target', 'node18-win-x64',
      '--output', outputFile,
      '--public'
    ]);

    console.log(`\n✅ Build Complete! Portable single EXE generated:`);
    console.log(`📍 Path: ${outputFile}`);
    console.log(`✨ Ready for standalone distribution (No Node.js required on target PC)`);
  } catch (err) {
    console.error('❌ Build failed:', err.message);
  }
}

buildExecutable();
