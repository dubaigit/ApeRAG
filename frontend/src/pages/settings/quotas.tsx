import { QuotaInfo, UserQuotaInfo, UserQuotaList, QuotaUpdateRequest } from '@/api';
import { PageContainer, PageHeader, RefreshButton } from '@/components';
import { quotasApi } from '@/services';
import { EditOutlined, ReloadOutlined } from '@ant-design/icons';
import { 
  Button, 
  Card, 
  Col, 
  Form, 
  InputNumber, 
  Modal, 
  Progress, 
  Row, 
  Select, 
  Table, 
  TableProps, 
  Typography, 
  message 
} from 'antd';
import { useCallback, useEffect, useState } from 'react';
import { FormattedMessage, useIntl, useModel } from 'umi';

export default () => {
  const { formatMessage } = useIntl();
  const userModel = useModel('user');
  const [userQuotas, setUserQuotas] = useState<UserQuotaInfo[]>([]);
  const [currentUserQuota, setCurrentUserQuota] = useState<UserQuotaInfo>();
  const [loading, setLoading] = useState<boolean>(false);
  const [editModalVisible, setEditModalVisible] = useState<boolean>(false);
  const [editingUser, setEditingUser] = useState<UserQuotaInfo>();
  const [form] = Form.useForm();

  const isAdmin = (userModel as any)?.currentUser?.role === 'admin';

  const getQuotaTypeName = (quotaType: string) => {
    const typeMap: Record<string, string> = {
      'max_collection_count': formatMessage({ id: 'quota.max_collection_count' }),
      'max_document_count': formatMessage({ id: 'quota.max_document_count' }),
      'max_document_count_per_collection': formatMessage({ id: 'quota.max_document_count_per_collection' }),
      'max_bot_count': formatMessage({ id: 'quota.max_bot_count' }),
    };
    return typeMap[quotaType] || quotaType;
  };

  const getQuotas = useCallback(async () => {
    setLoading(true);
    try {
      if (isAdmin) {
        // Admin: get all users' quotas
        const res = await quotasApi.quotasGet({ allUsers: true });
        const quotaList = res.data as UserQuotaList;
        setUserQuotas(quotaList.items);
      } else {
        // Regular user: get own quotas
        const res = await quotasApi.quotasGet();
        const userQuota = res.data as UserQuotaInfo;
        setCurrentUserQuota(userQuota);
      }
    } catch (error) {
      message.error(formatMessage({ id: 'quota.fetch_error' }));
    } finally {
      setLoading(false);
    }
  }, [isAdmin, formatMessage]);

  const handleEditQuota = (user: UserQuotaInfo) => {
    setEditingUser(user);
    setEditModalVisible(true);
    form.resetFields();
  };

  const handleUpdateQuota = async (values: { quota_type: string; new_limit: number }) => {
    if (!editingUser) return;

    try {
      await quotasApi.quotasUserIdPut({
        userId: editingUser.user_id,
        quotaUpdateRequest: {
          quota_type: values.quota_type as any,
          new_limit: values.new_limit
        }
      });
      message.success(formatMessage({ id: 'quota.update_success' }));
      setEditModalVisible(false);
      getQuotas();
    } catch (error) {
      message.error(formatMessage({ id: 'quota.update_error' }));
    }
  };

  const handleRecalculateUsage = async (userId: string) => {
    try {
      await quotasApi.quotasUserIdRecalculatePost({
        userId: userId
      });
      message.success(formatMessage({ id: 'quota.recalculate_success' }));
      getQuotas();
    } catch (error) {
      message.error(formatMessage({ id: 'quota.recalculate_error' }));
    }
  };

  const renderQuotaCard = (quota: QuotaInfo) => {
    const percentage = quota.quota_limit > 0 ? (quota.current_usage / quota.quota_limit) * 100 : 0;
    const status = percentage >= 100 ? 'exception' : percentage >= 80 ? 'active' : 'normal';

    return (
      <Card key={quota.quota_type} size="small" style={{ marginBottom: 8 }}>
        <div style={{ marginBottom: 8 }}>
          <Typography.Text strong>{getQuotaTypeName(quota.quota_type)}</Typography.Text>
        </div>
        <Progress
          percent={Math.min(percentage, 100)}
          status={status}
          format={() => `${quota.current_usage}/${quota.quota_limit}`}
        />
        <div style={{ marginTop: 4, fontSize: 12, color: '#666' }}>
          <FormattedMessage 
            id="quota.remaining" 
            values={{ remaining: quota.remaining }}
          />
        </div>
      </Card>
    );
  };

  const adminColumns: TableProps<UserQuotaInfo>['columns'] = [
    {
      title: formatMessage({ id: 'user.username' }),
      dataIndex: 'username',
      width: 120,
    },
    {
      title: formatMessage({ id: 'user.email' }),
      dataIndex: 'email',
      width: 200,
    },
    {
      title: formatMessage({ id: 'user.role' }),
      dataIndex: 'role',
      width: 80,
    },
    {
      title: formatMessage({ id: 'quota.quotas' }),
      dataIndex: 'quotas',
      render: (quotas: QuotaInfo[]) => (
        <div style={{ minWidth: 300 }}>
          {quotas.map(renderQuotaCard)}
        </div>
      ),
    },
    {
      title: formatMessage({ id: 'action.name' }),
      width: 120,
      render: (_, record) => (
        <div>
          <Button
            type="link"
            size="small"
            icon={<EditOutlined />}
            onClick={() => handleEditQuota(record)}
          >
            <FormattedMessage id="action.edit" />
          </Button>
          <Button
            type="link"
            size="small"
            icon={<ReloadOutlined />}
            onClick={() => handleRecalculateUsage(record.user_id)}
          >
            <FormattedMessage id="quota.recalculate" />
          </Button>
        </div>
      ),
    },
  ];

  useEffect(() => {
    getQuotas();
  }, [getQuotas]);

  return (
    <PageContainer>
      <PageHeader
        title={formatMessage({ id: 'quota.management' })}
        description={formatMessage({ id: 'quota.management_tips' })}
      >
        <RefreshButton loading={loading} onClick={getQuotas} />
      </PageHeader>

      {isAdmin ? (
        <Table
          rowKey="user_id"
          bordered
          columns={adminColumns}
          dataSource={userQuotas}
          loading={loading}
          pagination={{ pageSize: 10 }}
        />
      ) : (
        currentUserQuota && (
          <Row gutter={[16, 16]}>
            <Col span={24}>
              <Card title={formatMessage({ id: 'quota.my_quotas' })}>
                <Row gutter={[16, 16]}>
                  {currentUserQuota.quotas.map((quota) => (
                    <Col key={quota.quota_type} xs={24} sm={12} md={8} lg={6}>
                      {renderQuotaCard(quota)}
                    </Col>
                  ))}
                </Row>
              </Card>
            </Col>
          </Row>
        )
      )}

      <Modal
        title={formatMessage({ id: 'quota.edit_quota' })}
        open={editModalVisible}
        onCancel={() => setEditModalVisible(false)}
        onOk={() => form.submit()}
        destroyOnClose
      >
        <Form
          form={form}
          layout="vertical"
          onFinish={handleUpdateQuota}
        >
          <Form.Item
            name="quota_type"
            label={formatMessage({ id: 'quota.type' })}
            rules={[{ required: true }]}
          >
            <Select placeholder={formatMessage({ id: 'quota.select_type' })}>
              <Select.Option value="max_collection_count">
                {getQuotaTypeName('max_collection_count')}
              </Select.Option>
              <Select.Option value="max_document_count">
                {getQuotaTypeName('max_document_count')}
              </Select.Option>
              <Select.Option value="max_document_count_per_collection">
                {getQuotaTypeName('max_document_count_per_collection')}
              </Select.Option>
              <Select.Option value="max_bot_count">
                {getQuotaTypeName('max_bot_count')}
              </Select.Option>
            </Select>
          </Form.Item>
          <Form.Item
            name="new_limit"
            label={formatMessage({ id: 'quota.new_limit' })}
            rules={[
              { required: true },
              { type: 'number', min: 0 }
            ]}
          >
            <InputNumber
              min={0}
              style={{ width: '100%' }}
              placeholder={formatMessage({ id: 'quota.enter_new_limit' })}
            />
          </Form.Item>
        </Form>
      </Modal>
    </PageContainer>
  );
};
