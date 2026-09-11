"use client";

import { useEffect } from "react";

const TITLE = "Page not found | Vanteloq";
const DESCRIPTION = "The requested Vanteloq page could not be found.";

export default function NotFoundMetadataGuard() {
  useEffect(() => {
    const enforceNotFoundMetadata = () => {
      document.title = TITLE;
      document.querySelectorAll<HTMLLinkElement>('link[rel="canonical"]').forEach((link) => link.remove());

      const description = document.querySelector<HTMLMetaElement>('meta[name="description"]');
      const openGraphTitle = document.querySelector<HTMLMetaElement>('meta[property="og:title"]');
      const openGraphDescription = document.querySelector<HTMLMetaElement>('meta[property="og:description"]');
      const openGraphUrl = document.querySelector<HTMLMetaElement>('meta[property="og:url"]');
      const twitterTitle = document.querySelector<HTMLMetaElement>('meta[name="twitter:title"]');
      const twitterDescription = document.querySelector<HTMLMetaElement>('meta[name="twitter:description"]');

      if (description) description.content = DESCRIPTION;
      if (openGraphTitle) openGraphTitle.content = TITLE;
      if (openGraphDescription) openGraphDescription.content = DESCRIPTION;
      if (twitterTitle) twitterTitle.content = TITLE;
      if (twitterDescription) twitterDescription.content = DESCRIPTION;
      openGraphUrl?.remove();
    };

    enforceNotFoundMetadata();
    const observer = new MutationObserver(enforceNotFoundMetadata);
    observer.observe(document.head, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, []);

  return null;
}
