/** ClickUp Get Tasks returns at most 100 rows per zero-based page. */
export async function collectClickUpTaskPages<T>(
  fetchPage: (page: number) => Promise<{
    tasks?: T[];
    last_page?: boolean;
  }>,
  maxPages = 20,
): Promise<T[]> {
  const all: T[] = [];
  for (let page = 0; page < maxPages; page++) {
    const response = await fetchPage(page);
    const batch = response.tasks ?? [];
    all.push(...batch);
    if (response.last_page === true || batch.length < 100) return all;
  }
  throw new Error(`ClickUp task list exceeds ${maxPages} pages`);
}
