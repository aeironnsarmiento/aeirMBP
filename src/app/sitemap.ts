import type { MetadataRoute } from "next";
import { siteUrl } from "@/lib/site/url";

export default function sitemap(): MetadataRoute.Sitemap {
  return [{ url: siteUrl(), changeFrequency: "weekly", priority: 1 }];
}
