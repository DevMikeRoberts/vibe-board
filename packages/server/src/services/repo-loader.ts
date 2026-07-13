import { v4 as uuid } from 'uuid';
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

export interface GitHubUser {
  login: string;
  name?: string;
  avatar_url: string;
}

export interface RepoLoadResult {
  imported: number;
  skipped: number;
  errors: number;
}

/**
 * Fetch the authenticated GitHub user's profile.
 */
export async function fetchGithubUser(token: string): Promise<GitHubUser | null> {
  try {
    const response = await fetch('https://api.github.com/user', {
      headers: {
        'Authorization': `token ${token}`,
        'Accept': 'application/vnd.github.v3+json',
        'User-Agent': 'agentboard-repo-loader',
      },
    });
    if (!response.ok) return null;
    return await response.json() as GitHubUser;
  } catch {
    return null;
  }
}

/**
 * Fetch personal GitHub repositories using the GitHub API.
 * Returns only non-fork, accessible repositories.
 */
async function fetchPersonalRepos(token: string): Promise<GitHubRepository[]> {
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

      const pageRepos = (await response.json()) as GitHubRepository[];
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
 * Accepts an explicit token; falls back to the GITHUB_TOKEN env var.
 * Skips repos that are already loaded.
 * Returns a result object with counts.
 */
export async function autoLoadPersonalRepos(
  projectRepo: ProjectRepository,
  token?: string,
): Promise<RepoLoadResult> {
  const activeToken = (token ?? process.env.GITHUB_TOKEN)?.trim();
  if (!activeToken) {
    console.log('[repo-loader] no GitHub token available, skipping auto-load');
    return { imported: 0, skipped: 0, errors: 0 };
  }

  console.log('[repo-loader] fetching personal GitHub repositories...');
  const repos = await fetchPersonalRepos(activeToken);

  if (repos.length === 0) {
    console.log('[repo-loader] no personal repositories found');
    return { imported: 0, skipped: 0, errors: 0 };
  }

  console.log(`[repo-loader] found ${repos.length} personal repository(ies)`);

  let imported = 0;
  let skipped = 0;
  let errors = 0;

  for (const repo of repos) {
    try {
      // Skip forks unless explicitly included
      if (repo.fork) {
        console.log(`[repo-loader] skipping fork: ${repo.full_name}`);
        skipped++;
        continue;
      }

      const alreadyLoaded = await isRepoAlreadyLoaded(projectRepo, repo.clone_url);
      if (alreadyLoaded) {
        console.log(`[repo-loader] already loaded: ${repo.full_name}`);
        skipped++;
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
      imported++;
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      console.warn(`[repo-loader] failed to load ${repo.full_name}: ${message}`);
      errors++;
    }
  }

  console.log(`[repo-loader] completed: ${imported} imported, ${skipped} skipped, ${errors} errors`);
  return { imported, skipped, errors };
}
