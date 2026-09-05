import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const projectRoot = path.resolve(import.meta.dirname, '..');
const projectName = path.basename(projectRoot);
const siblingNames = {
  twiMonBot: 'ytWatchBot',
  ytWatchBot: 'twiMonBot',
};
const siblingName = siblingNames[projectName];

if (!siblingName) {
  throw new Error(`Unknown project name: ${projectName}`);
}

const sharedDirectory = path.join(projectRoot, 'src', 'shared');
const siblingSharedDirectory = path.join(projectRoot, '..', siblingName, 'src', 'shared');

if (!fs.existsSync(siblingSharedDirectory)) {
  console.log(`Skipping shared check: ${siblingName} is not checked out next to ${projectName}`);
  process.exit(0);
}

function listFiles(directory, relativeDirectory = '') {
  return fs
    .readdirSync(path.join(directory, relativeDirectory), {withFileTypes: true})
    .flatMap((entry) => {
      const relativePath = path.join(relativeDirectory, entry.name);
      return entry.isDirectory() ? listFiles(directory, relativePath) : relativePath;
    })
    .sort();
}

const files = listFiles(sharedDirectory);
const siblingFiles = listFiles(siblingSharedDirectory);
const differences = [];

for (const file of new Set([...files, ...siblingFiles])) {
  const pathInProject = path.join(sharedDirectory, file);
  const pathInSibling = path.join(siblingSharedDirectory, file);

  if (!fs.existsSync(pathInProject) || !fs.existsSync(pathInSibling)) {
    differences.push(file);
    continue;
  }

  if (!fs.readFileSync(pathInProject).equals(fs.readFileSync(pathInSibling))) {
    differences.push(file);
  }
}

if (differences.length) {
  console.error('Shared files differ:');
  differences.forEach((file) => console.error(`- ${file}`));
  process.exitCode = 1;
} else {
  console.log(`Shared files match ${siblingName} (${files.length} files)`);
}
