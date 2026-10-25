import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { loadPublicCommunityFirebase } from "@/core/sync/firebase";
import { SCHEMAS } from "@/core/dataSchemas";
import { timeAgo } from "../common";

interface PublicPost { id: string; kind: string; title: string; body: string; authorName: string; createdAt: number }
interface PublicCommunity { id: string; name: string; description: string; memberCount: number }


export function DataCatalog() {
  const [posts, setPosts] = useState<PublicPost[]>([]);
  const [communities, setCommunities] = useState<PublicCommunity[]>([]);
  const [tab, setTab] = useState<"community" | "schemas">("community");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let dead = false;
    void loadPublicCommunityFirebase().then(async ({ fs, fsMod }) => {
      const [postRows, communityRows] = await Promise.all([
        fsMod.getDocs(fsMod.query(fsMod.collection(fs, "communityPosts"), fsMod.orderBy("createdAt", "desc"), fsMod.limit(50))),
        fsMod.getDocs(fsMod.query(fsMod.collection(fs, "communities"), fsMod.where("visibility", "==", "public"), fsMod.limit(100))),
      ]);
      if (dead) return;
      setPosts(postRows.docs.map((item) => {
        const data = item.data();
        return { id: item.id, kind: String(data.kind ?? "discussion"), title: String(data.title ?? ""), body: String(data.body ?? ""), authorName: String(data.authorName ?? "Reader"), createdAt: Number(data.createdAt ?? 0) };
      }));
      setCommunities(communityRows.docs.map((item) => {
        const data = item.data();
        return { id: item.id, name: String(data.name ?? ""), description: String(data.description ?? ""), memberCount: Number(data.memberCount ?? 0) };
      }));
      setLoading(false);
    }).catch((cause: Error) => { if (!dead) { setError(cause.message); setLoading(false); } });
    return () => { dead = true; };
  }, []);

  return <div className="page data-catalog">
    <div className="topbar"><div><div className="kicker">Transparency</div><h1>Public data and schemas</h1></div></div>
    <p className="muted">Read-only public Community records and the database schema. Personal library, progress, profile and preferences are private and never listed here.</p>
    <div className="seg" role="tablist" aria-label="Public data view">
      <button role="tab" aria-selected={tab === "community"} className={tab === "community" ? "on" : ""} onClick={() => setTab("community")}>Community data</button>
      <button role="tab" aria-selected={tab === "schemas"} className={tab === "schemas" ? "on" : ""} onClick={() => setTab("schemas")}>Database schemas</button>
    </div>
    {error && <div className="err" role="alert">Could not load public Community data: {error}</div>}
    {loading && tab === "community" && <div className="chapter-loading"><span className="reader-spinner" /><span>Loading public data</span></div>}
    {tab === "schemas" ? <div className="data-schema-list">{SCHEMAS.map((schema) => <article className="data-schema" key={schema.path}>
      <code>{schema.path}</code><span className="tag">{schema.visibility}</span><p><strong>Fields:</strong> {schema.fields}</p>{schema.children && <p><strong>Subcollections:</strong> {schema.children}</p>}
    </article>)}</div> : <div className="data-community-grid">
      <section><h2>Recent public posts</h2><p className="muted">Latest 50; account IDs and private user data are not displayed.</p>{posts.map((post) => <article className="data-post" key={post.id}><div><strong>{post.title}</strong><span>{post.kind} · {post.authorName} · {timeAgo(post.createdAt)}</span></div><p>{post.body}</p></article>)}{!loading && !posts.length && <p className="muted">No public posts yet.</p>}</section>
      <section><h2>Public communities</h2><p className="muted">Private-community posts, channels and membership records are excluded.</p>{communities.map((community) => <article className="data-community" key={community.id}><strong>{community.name}</strong><p>{community.description}</p><span className="mono muted">{community.memberCount} members</span><Link to={`/community/${encodeURIComponent(community.id)}`}>Open public community</Link></article>)}{!loading && !communities.length && <p className="muted">No public communities yet.</p>}</section>
    </div>}
  </div>;
}