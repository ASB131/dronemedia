"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Search } from "lucide-react";

export function SearchBar() {
  const router = useRouter();
  const [query, setQuery] = useState("");

  return (
    <form
      className="mx-auto flex h-11 w-full max-w-2xl items-center gap-2 rounded-full border border-transparent bg-muted px-4 text-sm transition focus-within:border-primary/40 focus-within:bg-background focus-within:ring-2 focus-within:ring-primary/20"
      onSubmit={(event) => {
        event.preventDefault();
        const trimmed = query.trim();
        if (!trimmed) return;
        router.push(`/search?q=${encodeURIComponent(trimmed)}`);
      }}
    >
      <Search className="size-4 shrink-0 text-muted-foreground" />
      <input
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder="Search filename, place, drone, date…"
        className="w-full bg-transparent text-[15px] text-foreground outline-none placeholder:text-muted-foreground"
      />
    </form>
  );
}
