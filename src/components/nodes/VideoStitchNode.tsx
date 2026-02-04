"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Handle, Position, NodeProps, Node } from "@xyflow/react";
import { BaseNode } from "./BaseNode";
import { useCommentNavigation } from "@/hooks/useCommentNavigation";
import { useWorkflowStore } from "@/store/workflowStore";
import { VideoStitchNodeData } from "@/types";
import { checkEncoderSupport } from "@/hooks/useStitchVideos";

type VideoStitchNodeType = Node<VideoStitchNodeData, "videoStitch">;

export function VideoStitchNode({ id, data, selected }: NodeProps<VideoStitchNodeType>) {
  const nodeData = data;
  const commentNavigation = useCommentNavigation(id);
  const updateNodeData = useWorkflowStore((state) => state.updateNodeData);
  const edges = useWorkflowStore((state) => state.edges);
  const nodes = useWorkflowStore((state) => state.nodes);
  const [thumbnails, setThumbnails] = useState<Map<string, string>>(new Map());
  const regenerateNode = useWorkflowStore((state) => state.regenerateNode);
  const isRunning = useWorkflowStore((state) => state.isRunning);
  const removeEdge = useWorkflowStore((state) => state.removeEdge);

  // Check encoder support on mount
  useEffect(() => {
    if (nodeData.encoderSupported === null) {
      checkEncoderSupport().then((supported) => {
        updateNodeData(id, { encoderSupported: supported });
      });
    }
  }, [id, nodeData.encoderSupported, updateNodeData]);

  // Get connected video edges
  const videoEdges = useMemo(() => {
    return edges.filter(
      (e) => e.target === id && e.targetHandle?.startsWith("video-")
    );
  }, [edges, id]);

  // Sync clipOrder with connected edges (side effect, must be in useEffect)
  useEffect(() => {
    const currentEdgeIds = videoEdges.map((e) => e.id);
    const currentOrder = nodeData.clipOrder || [];

    // Keep existing order for edges that still exist, append new ones
    const validExisting = currentOrder.filter((eid) => currentEdgeIds.includes(eid));
    const newEdges = currentEdgeIds.filter((eid) => !currentOrder.includes(eid));
    const newOrder = [...validExisting, ...newEdges];

    if (
      newOrder.length !== currentOrder.length ||
      !newOrder.every((eid, idx) => eid === currentOrder[idx])
    ) {
      updateNodeData(id, { clipOrder: newOrder });
    }
  }, [videoEdges, nodeData.clipOrder, id, updateNodeData]);

  // Get ordered clips based on clipOrder or connection order
  const orderedClips = useMemo(() => {
    const clipMap = new Map<string, { edge: any; sourceNode: any; videoData: string | null; duration: number | null }>();

    videoEdges.forEach((edge) => {
      const sourceNode = nodes.find((n) => n.id === edge.source);
      if (!sourceNode) return;

      let videoData: string | null = null;
      let duration: number | null = null;

      if (sourceNode.type === "generateVideo" || sourceNode.type === "easeCurve" || sourceNode.type === "videoStitch") {
        videoData = (sourceNode.data as any).outputVideo || null;
      }

      clipMap.set(edge.id, { edge, sourceNode, videoData, duration });
    });

    let ordered: Array<{ edgeId: string; edge: any; sourceNode: any; videoData: string | null; duration: number | null }>;

    if (nodeData.clipOrder && nodeData.clipOrder.length > 0) {
      ordered = nodeData.clipOrder
        .map((edgeId) => {
          const clip = clipMap.get(edgeId);
          if (!clip) return null;
          return { edgeId, ...clip };
        })
        .filter((c): c is NonNullable<typeof c> => c !== null);

      // Append any new edges not in clipOrder yet
      videoEdges.forEach((edge) => {
        if (!nodeData.clipOrder.includes(edge.id)) {
          const clip = clipMap.get(edge.id);
          if (clip) {
            ordered.push({ edgeId: edge.id, ...clip });
          }
        }
      });
    } else {
      ordered = videoEdges
        .sort((a, b) => {
          const timeA = (a.data as any)?.createdAt ?? 0;
          const timeB = (b.data as any)?.createdAt ?? 0;
          return timeA - timeB;
        })
        .map((edge) => {
          const clip = clipMap.get(edge.id);
          if (!clip) return null;
          return { edgeId: edge.id, ...clip };
        })
        .filter((c): c is NonNullable<typeof c> => c !== null);
    }

    return ordered;
  }, [videoEdges, nodes, nodeData.clipOrder]);

  // Extract thumbnails from connected videos
  useEffect(() => {
    const extractThumbnails = async () => {
      const newThumbnails = new Map<string, string>();

      for (const clip of orderedClips) {
        if (!clip.videoData) continue;
        if (thumbnails.has(clip.edgeId)) {
          newThumbnails.set(clip.edgeId, thumbnails.get(clip.edgeId)!);
          continue;
        }

        try {
          const video = document.createElement("video");
          video.src = clip.videoData;
          video.crossOrigin = "anonymous";
          video.muted = true;

          await new Promise<void>((resolve, reject) => {
            video.onloadedmetadata = () => resolve();
            video.onerror = () => reject(new Error("Failed to load video"));
          });

          const seekTime = video.duration * 0.25;
          video.currentTime = seekTime;

          await new Promise<void>((resolve) => {
            video.onseeked = () => resolve();
          });

          const canvas = document.createElement("canvas");
          canvas.width = 160;
          canvas.height = 120;
          const ctx = canvas.getContext("2d");
          if (!ctx) continue;

          ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
          const thumbnail = canvas.toDataURL("image/jpeg", 0.7);
          newThumbnails.set(clip.edgeId, thumbnail);

          clip.duration = video.duration;
        } catch (error) {
          console.warn(`Failed to extract thumbnail for clip ${clip.edgeId}:`, error);
        }
      }

      setThumbnails(newThumbnails);
    };

    extractThumbnails();
  }, [orderedClips]);

  // Drag and drop for reordering clips
  const [draggedClipId, setDraggedClipId] = useState<string | null>(null);

  const handleDragStart = useCallback((e: React.DragEvent, edgeId: string) => {
    setDraggedClipId(edgeId);
    e.dataTransfer.effectAllowed = "move";
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent, targetEdgeId: string) => {
      e.preventDefault();
      if (!draggedClipId || draggedClipId === targetEdgeId) {
        setDraggedClipId(null);
        return;
      }

      const currentOrder = [...nodeData.clipOrder];
      const draggedIndex = currentOrder.indexOf(draggedClipId);
      const targetIndex = currentOrder.indexOf(targetEdgeId);

      if (draggedIndex === -1 || targetIndex === -1) {
        setDraggedClipId(null);
        return;
      }

      currentOrder.splice(draggedIndex, 1);
      currentOrder.splice(targetIndex, 0, draggedClipId);

      updateNodeData(id, { clipOrder: currentOrder });
      setDraggedClipId(null);
    },
    [draggedClipId, nodeData.clipOrder, id, updateNodeData]
  );

  const handleRemoveClip = useCallback(
    (edgeId: string) => {
      removeEdge(edgeId);
    },
    [removeEdge]
  );

  const handleStitch = useCallback(() => {
    regenerateNode(id);
  }, [id, regenerateNode]);

  // Dynamic video input handles
  const videoHandles = useMemo(() => {
    const count = Math.max(videoEdges.length + 1, 2);
    return Array.from({ length: count }, (_, i) => ({ id: `video-${i}` }));
  }, [videoEdges.length]);

  // Shared handles rendered in ALL states so connections always work
  const renderHandles = () => (
    <>
      {/* Dynamic video input handles (left side) */}
      {videoHandles.map((handle, index) => {
        const topPercent = ((index + 1) / (videoHandles.length + 1)) * 100;
        return (
          <React.Fragment key={handle.id}>
            <Handle
              type="target"
              position={Position.Left}
              id={handle.id}
              data-handletype="video"
              isConnectable={true}
              style={{ top: `${topPercent}%` }}
            />
            <div
              className="absolute text-[10px] font-medium whitespace-nowrap pointer-events-none text-right"
              style={{
                right: `calc(100% + 8px)`,
                top: `calc(${topPercent}% - 9px)`,
                color: "rgb(96, 165, 250)",
              }}
            >
              Video {index + 1}
            </div>
          </React.Fragment>
        );
      })}

      {/* Audio input handle (left side, bottom) */}
      <Handle
        type="target"
        position={Position.Left}
        id="audio"
        data-handletype="audio"
        isConnectable={true}
        style={{ top: "90%", background: "rgb(167, 139, 250)" }}
      />
      <div
        className="absolute text-[10px] font-medium whitespace-nowrap pointer-events-none text-right"
        style={{
          right: `calc(100% + 8px)`,
          top: "calc(90% - 18px)",
          color: "rgb(167, 139, 250)",
        }}
      >
        Audio
      </div>

      {/* Video output handle (right side) */}
      <Handle
        type="source"
        position={Position.Right}
        id="video"
        data-handletype="video"
        isConnectable={true}
      />
      <div
        className="absolute text-[10px] font-medium whitespace-nowrap pointer-events-none"
        style={{
          left: `calc(100% + 8px)`,
          top: "calc(50% - 9px)",
          color: "rgb(96, 165, 250)",
        }}
      >
        Output
      </div>
    </>
  );

  // Disable if encoder not supported
  if (nodeData.encoderSupported === false) {
    return (
      <BaseNode
        id={id}
        title="Video Stitch"
        customTitle={nodeData.customTitle}
        comment={nodeData.comment}
        onCustomTitleChange={(title) => updateNodeData(id, { customTitle: title || undefined })}
        onCommentChange={(comment) => updateNodeData(id, { comment: comment || undefined })}
        selected={selected}
        commentNavigation={commentNavigation ?? undefined}
        minWidth={500}
        minHeight={280}
      >
        {renderHandles()}
        <div className="flex-1 flex flex-col items-center justify-center gap-2 text-center px-4">
          <svg className="w-8 h-8 text-neutral-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
          </svg>
          <span className="text-xs text-neutral-400">
            Your browser doesn't support video encoding.
          </span>
          <a
            href="https://discord.gg/placeholder"
            target="_blank"
            rel="noopener noreferrer"
            className="text-[10px] text-blue-400 hover:text-blue-300 underline"
          >
            Doesn't seem right? Message Willie on Discord.
          </a>
        </div>
      </BaseNode>
    );
  }

  // Checking encoder state
  if (nodeData.encoderSupported === null) {
    return (
      <BaseNode
        id={id}
        title="Video Stitch"
        customTitle={nodeData.customTitle}
        comment={nodeData.comment}
        onCustomTitleChange={(title) => updateNodeData(id, { customTitle: title || undefined })}
        onCommentChange={(comment) => updateNodeData(id, { comment: comment || undefined })}
        selected={selected}
        commentNavigation={commentNavigation ?? undefined}
        minWidth={500}
        minHeight={280}
      >
        {renderHandles()}
        <div className="flex-1 flex items-center justify-center">
          <div className="flex items-center gap-2 text-neutral-400">
            <svg
              className="w-4 h-4 animate-spin"
              fill="none"
              viewBox="0 0 24 24"
            >
              <circle
                className="opacity-25"
                cx="12"
                cy="12"
                r="10"
                stroke="currentColor"
                strokeWidth="3"
              />
              <path
                className="opacity-75"
                fill="currentColor"
                d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
              />
            </svg>
            <span className="text-xs">Checking encoder...</span>
          </div>
        </div>
      </BaseNode>
    );
  }

  return (
    <BaseNode
      id={id}
      title="Video Stitch"
      customTitle={nodeData.customTitle}
      comment={nodeData.comment}
      onCustomTitleChange={(title) => updateNodeData(id, { customTitle: title || undefined })}
      onCommentChange={(comment) => updateNodeData(id, { comment: comment || undefined })}
      onRun={handleStitch}
      selected={selected}
      isExecuting={isRunning}
      hasError={nodeData.status === "error"}
      commentNavigation={commentNavigation ?? undefined}
      minWidth={500}
      minHeight={280}
    >
      {renderHandles()}

      <div className="flex-1 flex flex-col min-h-0 gap-2">
        {/* Filmstrip UI */}
        <div className="flex-1 flex flex-col min-h-0 gap-2">
          {orderedClips.length === 0 ? (
            <div className="flex-1 flex items-center justify-center border border-dashed border-neutral-600 rounded">
              <span className="text-[10px] text-neutral-500">Connect videos to stitch</span>
            </div>
          ) : (
            <>
              {/* Filmstrip */}
              <div className="flex-1 overflow-y-auto nowheel grid grid-cols-4 content-start gap-2 p-2 bg-neutral-900/50 rounded">
                {orderedClips.map((clip) => {
                  const thumbnail = thumbnails.get(clip.edgeId);
                  return (
                    <div
                      key={clip.edgeId}
                      draggable
                      onDragStart={(e) => handleDragStart(e, clip.edgeId)}
                      onDragOver={handleDragOver}
                      onDrop={(e) => handleDrop(e, clip.edgeId)}
                      className="nodrag relative w-full aspect-video bg-neutral-800 border border-neutral-600 rounded cursor-move hover:border-neutral-500 transition-colors group"
                    >
                      {thumbnail ? (
                        <img
                          src={thumbnail}
                          alt={`Clip ${clip.edgeId}`}
                          className="w-full h-full object-cover rounded"
                        />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center">
                          <svg
                            className="w-4 h-4 text-neutral-500"
                            fill="none"
                            viewBox="0 0 24 24"
                            stroke="currentColor"
                          >
                            <circle
                              className="opacity-25"
                              cx="12"
                              cy="12"
                              r="10"
                              stroke="currentColor"
                              strokeWidth="3"
                            />
                            <path
                              className="opacity-75"
                              fill="currentColor"
                              d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                            />
                          </svg>
                        </div>
                      )}

                      {/* Duration badge */}
                      {clip.duration && (
                        <div className="absolute bottom-1 right-1 bg-black/70 px-1 py-0.5 rounded text-[8px] text-white">
                          {Math.round(clip.duration)}s
                        </div>
                      )}

                      {/* Remove button */}
                      <button
                        onClick={() => handleRemoveClip(clip.edgeId)}
                        className="absolute top-0.5 right-0.5 w-4 h-4 bg-red-600/80 hover:bg-red-500 rounded text-white opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center"
                        title="Disconnect"
                      >
                        <svg className="w-2.5 h-2.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                        </svg>
                      </button>
                    </div>
                  );
                })}
              </div>

              {/* Stitch button */}
              <button
                onClick={handleStitch}
                disabled={orderedClips.length < 2 || nodeData.status === "loading" || isRunning}
                className="px-3 py-1.5 bg-blue-600 hover:bg-blue-500 disabled:bg-neutral-700 disabled:text-neutral-500 disabled:cursor-not-allowed rounded text-white text-xs font-medium transition-colors"
              >
                {nodeData.status === "loading" ? "Processing..." : "Stitch"}
              </button>
            </>
          )}
        </div>

        {/* Processing overlay */}
        {nodeData.status === "loading" && (
          <div className="absolute inset-0 bg-neutral-900/70 rounded flex flex-col items-center justify-center gap-2">
            <svg
              className="w-6 h-6 animate-spin text-white"
              fill="none"
              viewBox="0 0 24 24"
            >
              <circle
                className="opacity-25"
                cx="12"
                cy="12"
                r="10"
                stroke="currentColor"
                strokeWidth="3"
              />
              <path
                className="opacity-75"
                fill="currentColor"
                d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
              />
            </svg>
            <span className="text-white text-xs">Processing... {Math.round(nodeData.progress)}%</span>
          </div>
        )}

        {/* Output preview */}
        {nodeData.outputVideo && nodeData.status !== "loading" && (
          <div className="relative w-full">
            <video
              src={nodeData.outputVideo}
              controls
              autoPlay
              loop
              muted
              className="w-full h-auto max-h-40 object-contain rounded"
              playsInline
            />
            <button
              onClick={() => updateNodeData(id, { outputVideo: null, status: "idle" })}
              className="absolute top-1 right-1 w-5 h-5 bg-neutral-900/80 hover:bg-red-600/80 rounded flex items-center justify-center text-neutral-400 hover:text-white transition-colors"
              title="Clear video"
            >
              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        )}
      </div>
    </BaseNode>
  );
}
