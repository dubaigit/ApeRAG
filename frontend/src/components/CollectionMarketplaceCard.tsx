import { SharedCollection } from '@/api';
import { DATETIME_FORMAT } from '@/constants';
import { ShareAltOutlined, UserOutlined, ClockCircleOutlined, StarOutlined, HeartOutlined, HeartFilled } from '@ant-design/icons';
import { Card, Button, Tag, Typography, Space, Tooltip, Avatar } from 'antd';
import moment from 'moment';
import React from 'react';
import { FormattedMessage, useIntl, useModel } from 'umi';

const { Text, Title } = Typography;

interface CollectionMarketplaceCardProps {
  /**
   * Shared collection data
   */
  collection: SharedCollection;
  /**
   * Callback when clicking the card
   */
  onClick?: (collection: SharedCollection) => void;
  /**
   * Callback when subscribing to collection
   */
  onSubscribe?: (collectionId: string) => Promise<boolean>;
  /**
   * Callback when unsubscribing from collection
   */
  onUnsubscribe?: (collectionId: string) => Promise<boolean>;
  /**
   * Loading state for subscription operations
   */
  loading?: boolean;
}

export const CollectionMarketplaceCard: React.FC<CollectionMarketplaceCardProps> = ({
  collection,
  onClick,
  onSubscribe,
  onUnsubscribe,
  loading = false,
}) => {
  const { formatMessage } = useIntl();
  const { user } = useModel('user');

  const isOwner = user?.id === collection.owner_user_id;
  const isSubscribed = !!collection.subscription_id;
  const canSubscribe = !isOwner && !isSubscribed;
  const canUnsubscribe = !isOwner && isSubscribed;

  // Format relative time with i18n
  const formatRelativeTime = (timestamp: string) => {
    const now = moment();
    const time = moment(timestamp);
    const diffInMinutes = now.diff(time, 'minutes');
    const diffInHours = now.diff(time, 'hours');
    const diffInDays = now.diff(time, 'days');
    const diffInWeeks = now.diff(time, 'weeks');
    const diffInMonths = now.diff(time, 'months');
    const diffInYears = now.diff(time, 'years');

    if (diffInMinutes < 1) {
      return formatMessage({ id: 'collection.marketplace.time.just_now' });
    } else if (diffInMinutes < 60) {
      return formatMessage({ id: 'collection.marketplace.time.minutes_ago' }, { minutes: diffInMinutes });
    } else if (diffInHours < 24) {
      return formatMessage({ id: 'collection.marketplace.time.hours_ago' }, { hours: diffInHours });
    } else if (diffInDays < 7) {
      return formatMessage({ id: 'collection.marketplace.time.days_ago' }, { days: diffInDays });
    } else if (diffInWeeks < 4) {
      return formatMessage({ id: 'collection.marketplace.time.weeks_ago' }, { weeks: diffInWeeks });
    } else if (diffInMonths < 12) {
      return formatMessage({ id: 'collection.marketplace.time.months_ago' }, { months: diffInMonths });
    } else {
      return formatMessage({ id: 'collection.marketplace.time.years_ago' }, { years: diffInYears });
    }
  };

  // Truncate description to 120 characters for better layout
  const truncatedDescription = React.useMemo(() => {
    if (!collection.description) return '';
    return collection.description.length > 120 
      ? `${collection.description.substring(0, 120)}...`
      : collection.description;
  }, [collection.description]);

  const handleCardClick = () => {
    if (onClick) {
      onClick(collection);
    }
  };

  const handleSubscribe = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (onSubscribe) {
      await onSubscribe(collection.id);
    }
  };

  const handleUnsubscribe = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (onUnsubscribe) {
      await onUnsubscribe(collection.id);
    }
  };

  const renderActionButton = () => {
    if (isOwner) {
      return (
        <Tag 
          color="gold" 
          icon={<StarOutlined />} 
          style={{ 
            fontSize: '12px',
            borderRadius: 6,
            margin: 0,
            fontWeight: 500,
          }}
        >
          <FormattedMessage id="collection.marketplace.owner" />
        </Tag>
      );
    }

    if (canSubscribe) {
      return (
        <Button
          type="default"
          size="small"
          onClick={handleSubscribe}
          loading={loading}
          icon={<HeartOutlined />}
          style={{ 
            borderRadius: 6,
            fontSize: '12px',
            height: '28px',
            fontWeight: 500,
            borderColor: '#1890ff',
            color: '#1890ff',
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = '#1890ff';
            e.currentTarget.style.color = '#fff';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = 'transparent';
            e.currentTarget.style.color = '#1890ff';
          }}
        >
          <FormattedMessage id="collection.marketplace.subscribe" />
        </Button>
      );
    }

    if (canUnsubscribe) {
      return (
        <Button
          type="default"
          size="small"
          onClick={handleUnsubscribe}
          loading={loading}
          icon={<HeartFilled />}
          style={{ 
            borderRadius: 6,
            fontSize: '12px',
            height: '28px',
            fontWeight: 500,
            borderColor: '#1890ff',
            color: '#1890ff',
            background: '#f0f9ff',
          }}
        >
          <FormattedMessage id="collection.marketplace.subscribed" />
        </Button>
      );
    }

    return null;
  };

  return (
    <Card 
      hoverable={!loading}
      onClick={handleCardClick}
      style={{ 
        height: '100%',
        cursor: loading ? 'default' : 'pointer',
        opacity: loading ? 0.7 : 1,
        borderRadius: 12,
        border: '1px solid #e5e7eb',
        boxShadow: '0 1px 3px rgba(0, 0, 0, 0.1)',
        transition: 'all 0.2s ease-in-out',
        background: '#ffffff',
        minHeight: '200px',
      }}
      styles={{
        body: {
          padding: '16px',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
        },
      }}
      onMouseEnter={(e) => {
        if (!loading) {
          e.currentTarget.style.boxShadow = '0 4px 12px rgba(0, 0, 0, 0.15)';
          e.currentTarget.style.borderColor = '#d1d5db';
        }
      }}
      onMouseLeave={(e) => {
        if (!loading) {
          e.currentTarget.style.boxShadow = '0 1px 3px rgba(0, 0, 0, 0.1)';
          e.currentTarget.style.borderColor = '#e5e7eb';
        }
      }}
    >
      <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
        {/* Header with title */}
        <div style={{ 
          display: 'flex', 
          justifyContent: 'space-between', 
          alignItems: 'flex-start',
          marginBottom: 8,
        }}>
          <Title 
            level={5} 
            ellipsis={{ rows: 2, tooltip: collection.title }}
            style={{ 
              margin: 0, 
              flex: 1, 
              marginRight: 8,
              fontWeight: 600,
              fontSize: '16px',
              lineHeight: '1.3',
              color: '#111827',
            }}
          >
            {collection.title}
          </Title>
          {renderActionButton()}
        </div>

        {/* Description */}
        <div style={{ flex: 1, marginBottom: 12 }}>
          <Text 
            style={{ 
              fontSize: '13px',
              lineHeight: '1.4',
              color: '#6b7280',
              display: '-webkit-box',
              WebkitLineClamp: 3,
              WebkitBoxOrient: 'vertical',
              overflow: 'hidden',
              wordBreak: 'break-word',
            }}
          >
            {truncatedDescription || formatMessage({ id: 'collection.marketplace.no.description' })}
          </Text>
        </div>

        {/* Footer with owner and subscription info */}
        <div style={{ 
          display: 'flex', 
          justifyContent: 'space-between',
          alignItems: 'center',
          marginTop: 'auto',
          paddingTop: 8,
        }}>
          <Space size={6} align="center">
            <Avatar 
              size={16} 
              icon={<UserOutlined />} 
              style={{ 
                backgroundColor: '#6b7280',
                fontSize: '10px',
              }}
            />
            <Text style={{ 
              fontSize: '12px', 
              color: '#6b7280',
              fontWeight: 500,
            }}>
              {collection.owner_username}
            </Text>
          </Space>
          
          {collection.gmt_subscribed && isSubscribed && (
            <Space size={4} align="center">
              <ClockCircleOutlined style={{ fontSize: '11px', color: '#9ca3af' }} />
              <Text style={{ fontSize: '11px', color: '#9ca3af' }}>
                {formatRelativeTime(collection.gmt_subscribed)}
              </Text>
            </Space>
          )}
        </div>


      </div>
    </Card>
  );
};