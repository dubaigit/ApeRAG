import { GraphEdge, GraphNode } from '@/api';
import { api } from '@/services';
import {
  Button,
  Card,
  Divider,
  Select,
  Space,
  Tag,
  theme,
  Typography,
} from 'antd';
import Color from 'color';
import * as d3 from 'd3';
import _ from 'lodash';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useIntl, useModel } from 'umi';

import {
  FullscreenExitOutlined,
  FullscreenOutlined,
  Loading3QuartersOutlined,
} from '@ant-design/icons';
import ForceGraph2D from 'react-force-graph-2d';
import { MarketplaceNodeDetail } from './NodeDetail';

const color = d3.scaleOrdinal(d3.schemeCategory10);

interface MarketplaceGraphsProps {
  collectionId: string;
}

export const MarketplaceGraphs = ({ collectionId }: MarketplaceGraphsProps) => {
  const { formatMessage } = useIntl();
  const { token } = theme.useToken();
  const { themeName } = useModel('global');
  const containerRef = useRef<HTMLDivElement>(null);
  const graphRef = useRef<any>(null);
  const [fullscreen, setFullscreen] = useState<boolean>(false);
  const [loading, setLoading] = useState<boolean>(false);
  const [graphData, setGraphData] = useState<{
    nodes: GraphNode[];
    links: GraphEdge[];
  }>();

  const [dimensions, setDimensions] = useState({ width: 0, height: 0 });

  const [allEntities, setAllEntities] = useState<{
    [key in string]: (GraphNode & { value: number })[];
  }>({});
  const [activeEntities, setActiveEntities] = useState<string[]>([]);

  const [highlightNodes, setHighlightNodes] = useState(new Set());
  const [highlightLinks, setHighlightLinks] = useState(new Set());
  const [hoverNode, setHoverNode] = useState<GraphNode>();
  const [activeNode, setActiveNode] = useState<GraphNode>();

  const { NODE_MIN, NODE_MAX, LINK_MIN, LINK_MAX } = useMemo(
    () => ({
      NODE_MIN: 6,
      NODE_MAX: 18,
      LINK_MIN: 18,
      LINK_MAX: 36,
    }),
    [],
  );

  const getGraphData = useCallback(async () => {
    if (!collectionId) return;
    setLoading(true);
    try {
      const graphRes = await api.marketplaceCollectionsCollectionIdGraphGet({
        collectionId,
      });
      
      const rawNodes = graphRes.data.nodes || [];
      const rawEdges = graphRes.data.edges || [];
      
      const nodes = rawNodes.map((n) => {
        const targetCount = rawEdges.filter(
          (edg: any) => edg.target === n.id,
        ).length;
        const sourceCount = rawEdges.filter(
          (edg: any) => edg.source === n.id,
        ).length;
        return {
          ...n,
          value: Math.max(targetCount, sourceCount, NODE_MIN),
        } as GraphNode & { value: number };
      });
      const links = rawEdges as GraphEdge[];

      setGraphData({ nodes, links });

      setAllEntities(_.groupBy(nodes, (n) => n.properties?.entity_type || formatMessage({ id: 'collection.graph.entity.unknown' })));
    } catch (error) {
      console.error('Failed to load graph data:', error);
    } finally {
      setLoading(false);
    }
  }, [collectionId]);

  const handleCloseDetail = useCallback(() => {
    setActiveNode(undefined);
    setHoverNode(undefined);
    highlightNodes.clear();
    highlightLinks.clear();
  }, []);

  const handleSelectNode = useCallback(
    (id: string) => {
      const n = graphData?.nodes.find((nod) => nod.id === id);
      setActiveNode(n);
    },
    [graphData],
  );

  const handleResizeContainer = useCallback(() => {
    const container = containerRef.current;
    if (!container) return;
    const width = container.offsetWidth || 0;
    const height = container.offsetHeight || 0;
    setDimensions({
      width: width - 2,
      height: height - 2,
    });
  }, [fullscreen]);

  useEffect(() => {
    if (activeEntities.length) return;
    setActiveEntities(Object.keys(allEntities));
  }, [allEntities]);

  useEffect(() => handleResizeContainer(), [fullscreen]);
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    handleResizeContainer();
    window.addEventListener('resize', handleResizeContainer);
    return () => window.removeEventListener('resize', handleResizeContainer);
  }, []);

  useEffect(() => {
    highlightNodes.clear();
    highlightLinks.clear();
    if (activeNode) {
      const nodeLinks = graphData?.links.filter((link: any) => {
        return (
          link.source.id === activeNode.id || link.target.id === activeNode.id
        );
      });
      nodeLinks?.forEach((link: GraphEdge) => {
        highlightLinks.add(link);
        highlightNodes.add(link.source);
        highlightNodes.add(link.target);
      });
      highlightNodes.add(activeNode);
      graphRef.current?.centerAt((activeNode as any).x, (activeNode as any).y, 400);
      graphRef.current?.zoom(3, 600);
    } else {
      graphRef.current?.centerAt(0, 0, 400);
      graphRef.current?.zoom(1.5, 600);
    }
    setHighlightNodes(highlightNodes);
    setHighlightLinks(highlightLinks);
  }, [activeNode]);

  useEffect(() => {
    getGraphData();
    if (graphRef.current) {
      graphRef.current
        .d3Force(
          'link',
          d3.forceLink().distance((link: any) => {
            return Math.min(
              Math.max((link.source?.value || NODE_MIN), (link.target?.value || NODE_MIN), LINK_MIN),
              LINK_MAX,
            );
          }),
        )
        .d3Force('collision', d3.forceCollide().radius(NODE_MIN))
        .d3Force('charge', d3.forceManyBody().strength(-40))
        .d3Force('x', d3.forceX())
        .d3Force('y', d3.forceY());
    }
  }, [getGraphData]);

  return (
    <Card
      style={{
        display: 'flex',
        flexDirection: 'column',
        position: fullscreen ? 'fixed' : 'relative',
        height: fullscreen ? '100%' : 'calc(100vh - 180px)',
        left: 0,
        top: 0,
        right: 0,
        bottom: 0,
        zIndex: 1001,
        overflow: 'hidden',
      }}
      styles={{
        header: {
          padding: '4px 8px',
          minHeight: 'auto',
        },
        body: {
          flex: 1,
          padding: 0,
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        },
      }}
      title={
        <Select
          onChange={handleSelectNode}
          showSearch
          allowClear
          value={activeNode?.id}
          options={_.map(allEntities, (nods, cate) => {
            return {
              label: (
                <Typography style={{ color: color(cate) }}>{cate}</Typography>
              ),
              options: nods.map((n) => ({
                label: n.id,
                value: n.id,
              })),
            };
          })}
          placeholder={formatMessage({ id: 'action.search' })}
          style={{ width: 200 }}
        />
      }
      extra={
        <Space split={<Divider type="vertical" />}>
          <Button
            type="text"
            loading={loading}
            onClick={() => {
              getGraphData();
            }}
            icon={<Loading3QuartersOutlined />}
          />
          <Button
            type="text"
            icon={
              fullscreen ? <FullscreenExitOutlined /> : <FullscreenOutlined />
            }
            onClick={() => setFullscreen(!fullscreen)}
          />
        </Space>
      }
    >
      <div
        style={{
          padding: '4px 8px',
          background: token.colorBgContainer,
        }}
      >
        {_.map(allEntities, (item, key) => {
          const isActive = activeEntities.includes(key);
          return (
            <Tag
              key={key}
              color={isActive ? color(key) : undefined}
              style={{ cursor: 'pointer', userSelect: 'none' }}
              onClick={() => {
                setActiveEntities((items) => {
                  if (isActive) {
                    return _.reject(items, (item) => item === key);
                  } else {
                    return _.uniq(items.concat(key));
                  }
                });
              }}
            >
              {key}({item.length})
            </Tag>
          );
        })}
      </div>
      <div ref={containerRef} style={{ flex: 1 }}>
        <ForceGraph2D
          graphData={graphData}
          width={dimensions.width}
          height={dimensions.height}
          nodeLabel={(nod) => nod.id}
          ref={graphRef}
          nodeVisibility={(node) => {
            return (
              !node.properties?.entity_type ||
              activeEntities.includes(node.properties.entity_type)
            );
          }}
          minZoom={0.5}
          maxZoom={8}
          onNodeClick={(node) => {
            if (activeNode === node) {
              handleCloseDetail();
              return;
            }
            setActiveNode(node);
          }}
          onNodeHover={(node) => {
            if (activeNode) return;
            highlightNodes.clear();
            highlightLinks.clear();
            if (node) {
              const nodeLinks = graphData?.links.filter((link: any) => {
                return link.source.id === node.id || link.target.id === node.id;
              });
              nodeLinks?.forEach((link: GraphEdge) => {
                highlightLinks.add(link);
              });
            }
            setHoverNode(node || undefined);
            setHighlightNodes(highlightNodes);
            setHighlightLinks(highlightLinks);
          }}
          onLinkHover={(link) => {
            if (activeNode) return;
            highlightNodes.clear();
            highlightLinks.clear();
            if (link) {
              highlightLinks.add(link);
            }
            setHighlightNodes(highlightNodes);
            setHighlightLinks(highlightLinks);
          }}
          nodeCanvasObject={(node: any, ctx) => {
            const x = node.x || 0;
            const y = node.y || 0;

            let size = Math.min(node.value || NODE_MIN, NODE_MAX);
            if (node === hoverNode) size += 1;
            ctx.beginPath();
            ctx.arc(x, y, size, 0, 2 * Math.PI, false);

            const colorNormal = color(node.properties?.entity_type || '');
            let colorSecondary =
              themeName === 'dark'
                ? Color(colorNormal).grayscale().darken(0.3)
                : Color(colorNormal).grayscale().lighten(0.6);
            ctx.fillStyle =
              highlightNodes.size === 0 || highlightNodes.has(node)
                ? colorNormal
                : colorSecondary.string();
            ctx.fill();

            // node circle
            ctx.beginPath();
            ctx.arc(x, y, size, 0, 2 * Math.PI, false);
            ctx.lineWidth = 1;
            ctx.strokeStyle = highlightNodes.has(node)
              ? Color('#FFF').grayscale().string()
              : '#FFF';
            ctx.stroke();

            // node label
            let fontSize = 15;
            const offset = 2;
            ctx.font = `${fontSize}px Arial`;
            let textWidth = ctx.measureText(node.id).width - offset;
            do {
              fontSize -= 1;
              ctx.font = `${fontSize}px Arial`;
              textWidth = ctx.measureText(node.id).width - offset;
            } while (textWidth > size && fontSize > 0);
            ctx.fillStyle = '#fff';
            ctx.fillText(
              node.id,
              x - (textWidth + offset) / 2,
              y + fontSize / 2,
            );
          }}
          nodePointerAreaPaint={(node, color, ctx) => {
            const x = node.x || 0;
            const y = node.y || 0;
            const size = Math.min(node.value, NODE_MAX);
            ctx.fillStyle = color;
            ctx.beginPath();
            ctx.arc(x, y, size, 0, 2 * Math.PI, false);
            ctx.fill();
          }}
          linkLabel="id"
          linkColor={(link) => {
            if (themeName === 'dark') {
              return highlightLinks.has(link) ? '#EEE' : '#55595F';
            } else {
              return highlightLinks.has(link) ? '#999' : '#DDD';
            }
          }}
          linkWidth={(link) => {
            return highlightLinks.has(link) ? 2 : 1;
          }}
          linkDirectionalParticleWidth={(link) => {
            return highlightLinks.has(link) ? 3 : 0;
          }}
          linkDirectionalParticles={2}
          linkVisibility={(link: any) => {
            const sourceEntityType = link.source?.properties?.entity_type || '';
            const tatgetEntityType = link.target?.properties?.entity_type || '';
            return (
              activeEntities.includes(sourceEntityType) &&
              activeEntities.includes(tatgetEntityType)
            );
          }}
        />
      </div>
      <MarketplaceNodeDetail
        open={Boolean(activeNode)}
        node={activeNode}
        onClose={handleCloseDetail}
      />
    </Card>
  );
};