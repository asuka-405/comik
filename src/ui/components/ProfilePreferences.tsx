import { useLiveQuery } from "dexie-react-hooks";
import { db } from "@/core/db";
import { useSettings } from "@/core/settings";
import { DEFAULT_COMMUNITY_PROFILE, DEFAULT_TASTE_PREFERENCES, inferGenrePreferences } from "@/core/preferences";

export function ProfilePreferences() {
  const settings = useSettings();
  const inferredGenres = useLiveQuery(async () => {
    const shelf = await db.manga.where("libraryFlag").equals(1).toArray();
    const recentChapters = await db.chapters.where("readAt").above(0).reverse().limit(500).toArray();
    const recentIds = [...new Set(recentChapters.map((chapter) => chapter.mangaId))];
    const recentManga = (await db.manga.bulkGet(recentIds)).filter((manga): manga is NonNullable<typeof manga> => !!manga);
    const items = new Map([...shelf, ...recentManga].map((manga) => [manga.id, manga]));
    return inferGenrePreferences([...items.values()], recentChapters);
  }, [], []);
  const profile = settings.communityProfile;
  const taste = settings.tastePreferences;
  const setTasteGenres = (field: "includeGenres" | "avoidGenres", genre: string, checked: boolean) => {
    const values = new Set(taste[field]);
    if (checked) values.add(genre); else values.delete(genre);
    settings.set({ tastePreferences: { ...taste, [field]: [...values] } });
  };

  return <section className="account-actions account-profile">
    <div><span className="kicker">Your identity and interests</span><h2>Profile and preferences</h2><p className="muted">This information stays in your private account settings. Your display name is shown on new Community contributions.</p></div>
    <div className="community-profile-fields">
      <label><span className="label">Username</span><input className="input" autoComplete="username" maxLength={24} value={profile.username} onChange={(event) => settings.set({ communityProfile: { ...profile, username: event.target.value.replace(/^@/, "").replace(/[^\p{L}\p{N}_-]/gu, "").slice(0, 24) } })} placeholder="reader_name" /></label>
      <label><span className="label">Display name</span><input className="input" autoComplete="nickname" maxLength={40} value={profile.displayName} onChange={(event) => settings.set({ communityProfile: { ...profile, displayName: event.target.value.slice(0, 40) } })} placeholder="Reader" /></label>
    </div>
    <div className="profile-preference-controls">
      <label className="profile-auto-build"><input type="checkbox" checked={taste.autoBuild} onChange={(event) => settings.set({ tastePreferences: { ...taste, autoBuild: event.target.checked } })} /> Build from my shelf and recent activity</label>
      <div className="taste-preference-list">
        {(taste.autoBuild ? inferredGenres.map((item) => item.name) : [...new Set([...taste.includeGenres, ...taste.avoidGenres])]).map((genre) => <div className="taste-preference-row" key={genre}>
          <strong>{genre}</strong>
          <label><input type="checkbox" checked={taste.includeGenres.includes(genre)} onChange={(event) => setTasteGenres("includeGenres", genre, event.target.checked)} /> Prefer</label>
          <label><input type="checkbox" checked={taste.avoidGenres.includes(genre)} onChange={(event) => setTasteGenres("avoidGenres", genre, event.target.checked)} /> Avoid</label>
        </div>)}
        {taste.autoBuild && !inferredGenres.length && <p className="muted">Preferences appear as your library gains genre tags and reading activity.</p>}
      </div>
    </div>
    <button className="btn" onClick={() => settings.set({ communityProfile: DEFAULT_COMMUNITY_PROFILE, tastePreferences: DEFAULT_TASTE_PREFERENCES })}>Reset personalization</button>
  </section>;
}