import { v4 as uuid } from 'uuid';
import { getCloneRoot } from '../config.js';
import type { ProjectRepository } from '../repositories/project-types.js';
import { normalizeRepoUrl } from '../routes/helpers.js';

interface GitHubRepository {
  id: number;
  name: string;
  full_name: string;
  html_url: string;
  clone_url: string;
  private: boolean;
  fork: boolean;
}

/**
 * Fetch personal GitHub repositories using the GitHub API.
 * Requires a GITHUB_TOKEN environment variable to be set.
 * Returns only non-fork, accessible repositories.
 */
async function fetchPersonalRepos(): Promise<GitHubRepository[]> {
  const token = process.env.GITHUB_TOKEN?.trim();
  if (!token) return [];

  try {
    const repos: GitHubRepository[] = [];
    let page = 1;
    let hasMore = true;

    while (hasMore) {
      const response = await fetch(
        `https://api.github.com/user/repos?per_page=100&page=${page}&type=owner`,
        {
          headers: {
            'Authorization': `token ${token}`,
            'Accept': 'application/vnd.github.v3+json',
            'User-Agent': 'agentboard-repo-loader',
          },
        }
      );

      if (!response.ok) {
        console.error(`[repo-loader] GitHub API error (page ${page}): ${response.status} ${response.statusText}`);
        break;
      }

      const pageRepos: GitHubRepository[] = await response.json();
      if (pageRepos.length === 0) {
        hasMore = false;
      } else {
        repos.push(...pageRepos);
        page++;
      }
    }

    return repos;
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[repo-loader] failed to fetch personal repos: ${message}`);
    return [];
  }
}

/**
 * Check if a repo is already loaded as a project by comparing normalized URLs.
 */
async function isRepoAlreadyLoaded(
  projectRepo: ProjectRepository,
  repoUrl: string,
): Promise<boolean> {
  const normalizedInput = normalizeRepoUrl(repoUrl);
  const allProjects = await projectRepo.getAllWithCounts();

  for (const project of allProjects) {
    if (project.repoUrl) {
      const normalizedExisting = normalizeRepoUrl(project.repoUrl);
      if (normalizedExisting === normalizedInput) {
        return true;
      }
    }
  }

  return false;
}

/**
 * Auto-load personal GitHub repositories as projects.
 * This is called on server startup if a GITHUB_TOKEN is configured.
 * Skips repos that are already loaded.
 */
export async function autoLoadPersonalRepos(projectRepo: ProjectRepository): Promise<void> {
  const token = process.env.GITHUB_TOKEN?.trim();
  if (!token) {
    console.log('[repo-loader] GITHUB_TOKEN not set, skipping auto-load');
    return;
  }

  console.log('[repo-loader] fetching personal GitHub repositories...');
  const repos = await fetchPersonalRepos();

  if (repos.length === 0) {
    console.log('[repo-loader] no personal repositories found');
    return;
  }

  console.log(`[repo-loader] found ${repos.length} personal repository(ies)`);

  let loadedCount = 0;
  let skippedCount = 0;

  for (const repo of repos) {
    try {
      // Skip forks unless explicitly included
      if (repo.fork) {
        console.log(`[repo-loader] skipping fork: ${repo.full_name}`);
        skippedCount++;
        continue;
      }

      const alreadyLoaded = await isRepoAlreadyLoaded(projectRepo, repo.clone_url);
      if (alreadyLoaded) {
        console.log(`[repo-loader] already loaded: ${repo.full_name}`);
        skippedCount++;
        continue;
      }

      const now = Date.now();
      const project = await projectRepo.create({
        id: uuid(),
        name: repo.name,
        repoUrl: repo.clone_url,
        createdAt: now,
        updatedAt: now,
      });

      console.log(`[repo-loader] loaded project: ${repo.full_name} (${project.id})`);
      loadedCount++;
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      console.warn(`[repo-loader] failed to load ${repo.full_name}: ${message}`);
    }
  }

  console.log(`[repo-loader] completed: ${loadedCount} loaded, ${skippedCount} skipped`);
}
