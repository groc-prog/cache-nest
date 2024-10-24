import fse from 'fs-extra';
import path from 'path';

/**
 * Returns the size of the directory and all of it's subdirectories/files.
 * @async
 * @param {string} dirPath - The path to the directory to check.
 * @returns {Promise<number>} The size of the directory.
 */
export async function getDirectorySize(dirPath: string): Promise<number> {
  let totalSize = 0;

  const files = await fse.readdir(dirPath);

  for (const file of files) {
    const filePath = path.join(dirPath, file);
    const stats = await fse.stat(filePath);

    if (stats.isDirectory()) {
      totalSize += await getDirectorySize(filePath);
    } else {
      totalSize += stats.size;
    }
  }

  return totalSize;
}
