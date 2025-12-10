"use client";

import { useState } from "react";
import { URLLoaderNodeEditor } from "@/components/builder/nodes/URLLoaderNodeEditor";
import type { URLLoaderConfig, URLContextItem } from "@/types/pipeline";
import { useURLLoader } from "@/hooks/useURLLoader";
import styles from "./Tutorial.module.css";

export function URLLoaderTutorial() {
  const [config, setConfig] = useState<URLLoaderConfig>({ url: "" });
  const urlLoader = useURLLoader();
  const [urlContext, setUrlContext] = useState<URLContextItem | null>(null);

  const handleLoadURL = async (nodeId: string, url: string, label?: string) => {
    await urlLoader.loadURL(nodeId, url, label);
    const context = urlLoader.urlContexts[nodeId] || null;
    setUrlContext(context);
  };

  return (
    <div className={styles.tutorial}>
      <div className={styles.section}>
        <h3>What is a URL Loader?</h3>
        <p>
          The URL Loader fetches content from web pages and adds it to your pipeline's context.
          This is useful for RAG (Retrieval-Augmented Generation) - giving the model access to
          external information.
        </p>
      </div>

      <div className={styles.section}>
        <h3>Try it yourself</h3>
        <p>Enter a URL to fetch its content:</p>
        <div className={styles.liveDemo}>
          <URLLoaderNodeEditor
            config={config}
            onChange={setConfig}
            urlContext={urlContext}
            onLoadURL={handleLoadURL}
            nodeId="tutorial-url-loader"
            loading={urlLoader.loadingUrlNodeIds.has("tutorial-url-loader")}
          />
        </div>
      </div>

      {urlContext && (
        <div className={styles.section}>
          <h3>Loaded Content</h3>
          <div className={styles.urlPreview}>
            <div className={styles.urlPreviewHeader}>
              <strong>URL:</strong> {urlContext.url}
            </div>
            <div className={styles.urlPreviewContent}>
              {urlContext.content.slice(0, 500)}
              {urlContext.content.length > 500 && "..."}
            </div>
            <div className={styles.urlPreviewFooter}>
              {urlContext.content.length} characters loaded
            </div>
          </div>
        </div>
      )}

      <div className={styles.section}>
        <h3>How it works</h3>
        <p>
          When you load a URL, the content is fetched and stored. Any inference node that comes
          after this URL Loader will have access to this content in its context. This allows
          the model to answer questions about web pages, summarize articles, or use external
          information in its responses.
        </p>
      </div>
    </div>
  );
}
