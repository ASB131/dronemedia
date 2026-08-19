"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Search } from "lucide-react";

export function SearchBar() {
  const router = useRouter();
  const [query, setQuery] = useState("");

  return (
    <form
      className="flex h-12 w-full max-w-3xl items-center gap-3 rounded-full bg-muted px-5 text-base dark:bg-[#1c1c1c]"
      onSubmit={(event) => {
        event.preventDefault();
        const trimmed = query.trim();
        if (!trimmed) return;
        router.push(`/search?q=${encodeURIComponent(trimmed)}`);
      }}
    >
      <Search className="size-5 shrink-0 text-muted-foreground" />
      <input
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder="Search your photos"
        className="w-full bg-transparent text-base text-foreground outline-none placeholder:text-muted-foreground"
      />
    </form>
  );
}
