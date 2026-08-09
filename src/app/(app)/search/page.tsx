import { SearchResultsView } from "@/components/search/search-results-view";

export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const params = await searchParams;

  return <SearchResultsView initialQuery={params.q ?? ""} />;
}
