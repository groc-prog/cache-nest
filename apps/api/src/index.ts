import type { Subprocess } from 'bun';
import path from 'path';

import { apiConfiguration } from '@/setup';

const clusterCount = apiConfiguration.server.clustering.enabled ? apiConfiguration.server.clustering.clusters : 1;
const clusters: Subprocess[] = new Array(clusterCount);

for (let i = 0; i < clusterCount; i++) {
  clusters[i] = Bun.spawn({
    cmd: ['bun', path.join(import.meta.dir, 'server.ts')],
    stdin: 'inherit',
    stdout: 'inherit',
    stderr: 'inherit',
  });
}

function kill() {
  for (const cluster of clusters) cluster.kill();
}

process.on('SIGINT', kill);
process.on('exit', kill);
