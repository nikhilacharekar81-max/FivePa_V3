import * as fs from 'fs';
import * as Diff from 'diff';

const patchText = fs.readFileSync('workstream_P0_P1_clean.txt', 'utf8');
const parsedPatches = Diff.parsePatch(patchText);

let success = true;
for (const p of parsedPatches) {
  const fileName = p.newFileName || p.oldFileName;
  if (!fileName) continue;
  const targetPath = fileName.replace(/^[ab]\//, '');
  if (!fs.existsSync(targetPath)) {
    console.error(`Target file does not exist: ${targetPath}`);
    success = false;
    continue;
  }
  const fileContent = fs.readFileSync(targetPath, 'utf8');
  const patched = Diff.applyPatch(fileContent, p);
  if (patched === false) {
    console.error(`Failed to apply patch to ${targetPath}`);
    success = false;
  } else {
    fs.writeFileSync(targetPath, patched, 'utf8');
    console.log(`Successfully patched ${targetPath}`);
  }
}

if (!success) {
  console.error('Patch application failed.');
  process.exit(1);
} else {
  console.log('All patches applied successfully.');
}
