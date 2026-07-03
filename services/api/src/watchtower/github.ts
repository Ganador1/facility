export type GitHubRepoRef = { owner: string; name: string };

export type PullRequest = {
  number: number;
  user?: { login?: string | null } | null;
  head?: { ref?: string | null } | null;
  created_at: string;
  closed_at: string | null;
  merged_at: string | null;
};

export type PullCommit = {
  author?: { login?: string | null } | null;
  commit?: { author?: { date?: string | null } | null } | null;
};

export type PullReview = {
  state?: string | null;
  submitted_at?: string | null;
};

export type WorkflowRun = {
  id: number;
  name?: string | null;
  status?: string | null;
  conclusion?: string | null;
  html_url?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
};

export type GitHubClient = {
  listClosedPulls(repo: GitHubRepoRef, perPage?: number): Promise<PullRequest[]>;
  listPullCommits(repo: GitHubRepoRef, number: number): Promise<PullCommit[]>;
  listPullReviews(repo: GitHubRepoRef, number: number): Promise<PullReview[]>;
  listWorkflowRuns(repo: GitHubRepoRef, sinceIso: string): Promise<WorkflowRun[]>;
  readTextFile(repo: GitHubRepoRef, path: string, ref?: string): Promise<string | null>;
};

function token() {
  return process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN;
}

async function githubApi<T>(path: string): Promise<T> {
  const headers: Record<string, string> = {
    accept: "application/vnd.github+json",
    "x-github-api-version": "2022-11-28",
  };
  const githubToken = token();
  if (githubToken) headers.authorization = `Bearer ${githubToken}`;
  const response = await fetch(`https://api.github.com${path}`, { headers });
  if (response.status === 404) {
    throw new Error(`github_not_found:${path}`);
  }
  if (!response.ok) {
    throw new Error(`github_api_failed:${response.status}:${path}`);
  }
  return (await response.json()) as T;
}

function repoPath(repo: GitHubRepoRef) {
  return `/repos/${repo.owner}/${repo.name}`;
}

export function createGitHubClient(): GitHubClient {
  return {
    listClosedPulls: async (repo, perPage = 100) =>
      githubApi<PullRequest[]>(
        `${repoPath(repo)}/pulls?state=closed&sort=updated&direction=desc&per_page=${Math.min(
          perPage,
          100,
        )}`,
      ),
    listPullCommits: (repo, number) =>
      githubApi<PullCommit[]>(`${repoPath(repo)}/pulls/${number}/commits?per_page=100`),
    listPullReviews: (repo, number) =>
      githubApi<PullReview[]>(`${repoPath(repo)}/pulls/${number}/reviews?per_page=100`),
    listWorkflowRuns: async (repo, sinceIso) => {
      const query = encodeURIComponent(`>${sinceIso}`);
      const data = await githubApi<{ workflow_runs?: WorkflowRun[] }>(
        `${repoPath(repo)}/actions/runs?created=${query}&per_page=100`,
      );
      return data.workflow_runs ?? [];
    },
    readTextFile: async (repo, path, ref) => {
      const suffix = ref ? `?ref=${encodeURIComponent(ref)}` : "";
      try {
        const data = await githubApi<{ content?: string; encoding?: string }>(
          `${repoPath(repo)}/contents/${path}${suffix}`,
        );
        if (data.encoding !== "base64" || !data.content) return null;
        return Buffer.from(data.content.replace(/\n/g, ""), "base64").toString("utf8");
      } catch (error) {
        if (error instanceof Error && error.message.startsWith("github_not_found:")) return null;
        throw error;
      }
    },
  };
}
