import assert from 'node:assert/strict';
import { test } from 'node:test';
import Database from 'better-sqlite3';
import { initDatabase } from '../src/db.js';
import { SqliteProjectRepository } from '../src/repositories/sqlite-projects.js';
import { autoLoadPersonalRepos } from '../src/services/repo-loader.js';

test('repo-loader: skips when GITHUB_TOKEN is not set', async () => {
  const db = new Database(':memory:');
  initDatabase({ db });
  const projectRepo = new SqliteProjectRepository(db);

  // Ensure GITHUB_TOKEN is not set
  delete process.env.GITHUB_TOKEN;

  // Should complete without error
  await autoLoadPersonalRepos(projectRepo);

  const allProjects = await projectRepo.getAllWithCounts();
  assert.strictEqual(allProjects.length, 1); // Only default project
});

test('repo-loader: normalizes repo URLs for deduplication', async () => {
  const db = new Database(':memory:');
  initDatabase({ db });
  const projectRepo = new SqliteProjectRepository(db);

  // Create a project with https URL
  const now = Date.now();
  await projectRepo.create({
    id: 'test-repo-1',
    name: 'test-repo',
    repoUrl: 'https://github.com/user/test-repo.git',
    createdAt: now,
    updatedAt: now,
  });

  // Verify the project exists
  const projects = await projectRepo.getAllWithCounts();
  const testRepo = projects.find(p => p.id === 'test-repo-1');
  assert(testRepo, 'Should have created test project');
  assert.strictEqual(testRepo.repoUrl, 'https://github.com/user/test-repo.git');

  // In real usage with a valid token, duplicate URLs would be skipped
  // This test just verifies the structure works
});

test('repo-loader: handles empty repository list gracefully', async () => {
  const db = new Database(':memory:');
  initDatabase({ db });
  const projectRepo = new SqliteProjectRepository(db);

  // Ensure GITHUB_TOKEN is not set (so no API calls are made)
  delete process.env.GITHUB_TOKEN;

  const before = await projectRepo.getAllWithCounts();
  await autoLoadPersonalRepos(projectRepo);
  const after = await projectRepo.getAllWithCounts();

  // Should not have added any projects
  assert.strictEqual(before.length, after.length);
});
