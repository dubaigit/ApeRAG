import { QuotaInfo, UserQuotaInfo, UserQuotaList, QuotaUpdateRequest } from '@/api';
import { PageContainer, PageHeader, RefreshButton } from '@/components';
import { quotasApi } from '@/services';
import { EditOutlined, ReloadOutlined, SettingOutlined } from '@ant-design/icons';
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
  message,
  Tabs 
} from 'antd';
import { useCallback, useEffect, useState } from 'react';
import { FormattedMessage, useIntl, useModel } from 'umi';

interface SystemDefaultQuotas {
  max_collection_count: number;
  max_document_count: number;
  max_document_count_per_collection: number;
  max_bot_count: number;
}

export default () => {
  const { formatMessage } = useIntl();
  const userModel = useModel('user');
  const [userQuotas, setUserQuotas] = useState<UserQuotaInfo[]>([]);
  const [currentUserQuota, setCurrentUserQuota] = useState<UserQuotaInfo>();
  const [systemDefaultQuotas, setSystemDefaultQuotas] = useState<SystemDefaultQuotas>();
  const [loading, setLoading] = useState<boolean>(false);
  const [systemQuotasLoading, setSystemQuotasLoading] = useState<boolean>(false);
  const [editModalVisible, setEditModalVisible] = useState<boolean>(false);
  const [systemQuotasModalVisible, setSystemQuotasModalVisible] = useState<boolean>(false);
  const [editingUser, setEditingUser] = useState<UserQuotaInfo>();
  const [form] = Form.useForm();
  const [systemQuotasForm] = Form.useForm();

  const isAdmin = (userModel as any)?.user?.role === 'admin';
  
  // Debug: log user info
  console.log('User model:', userModel);
  console.log('User:', (userModel as any)?.user);
  console.log('User role:', (userModel as any)?.user?.role);
  console.log('Is admin:', isAdmin);

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

  const getSystemDefaultQuotas = useCallback(async () => {
    if (!isAdmin) return;
    
    setSystemQuotasLoading(true);
    try {
      // Use the same request configuration as other API calls
      const response = await fetch('/api/v1/system/default-quotas', {
        credentials: 'include', // Include cookies for authentication
        headers: {
          'Content-Type': 'application/json',
        },
      });
      
      if (response.ok) {
        const data = await response.json();
        setSystemDefaultQuotas(data.quotas);
      } else {
        throw new Error('Failed to fetch system default quotas');
      }
    } catch (error) {
      message.error(formatMessage({ id: 'quota.system_fetch_error' }));
    } finally {
      setSystemQuotasLoading(false);
    }
  }, [isAdmin, formatMessage]);

  const handleEditSystemQuotas = () => {
    if (systemDefaultQuotas) {
      systemQuotasForm.setFieldsValue(systemDefaultQuotas);
      setSystemQuotasModalVisible(true);
    }
  };

  const handleUpdateSystemQuotas = async (values: SystemDefaultQuotas) => {
    try {
      // Use the same request configuration as other API calls
      const response = await fetch('/api/v1/system/default-quotas', {
        method: 'PUT',
        credentials: 'include', // Include cookies for authentication
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ quotas: values }),
      });
      
      if (response.ok) {
        message.success(formatMessage({ id: 'quota.system_update_success' }));
        setSystemQuotasModalVisible(false);
        getSystemDefaultQuotas();
      } else {
        throw new Error('Failed to update system default quotas');
      }
    } catch (error) {
      message.error(formatMessage({ id: 'quota.system_update_error' }));
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

  const userQuotaColumns: TableProps<QuotaInfo>['columns'] = [
    {
      title: formatMessage({ id: 'quota.name' }),
      dataIndex: 'quota_type',
      render: (quotaType: string) => getQuotaTypeName(quotaType),
    },
    {
      title: formatMessage({ id: 'quota.max_limit' }),
      dataIndex: 'quota_limit',
      align: 'right',
    },
    {
      title: formatMessage({ id: 'quota.current_usage' }),
      dataIndex: 'current_usage',
      align: 'right',
    },
    {
      title: formatMessage({ id: 'quota.usage_rate' }),
      render: (_, record) => {
        const percentage = record.quota_limit > 0 ? (record.current_usage / record.quota_limit) * 100 : 0;
        const status = percentage >= 100 ? 'exception' : percentage >= 80 ? 'active' : 'normal';
        return (
          <Progress
            percent={Math.min(percentage, 100)}
            status={status}
            size="small"
            format={() => `${Math.round(percentage)}%`}
          />
        );
      },
    },
  ];

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
    if (isAdmin) {
      getSystemDefaultQuotas();
    }
  }, [getQuotas, getSystemDefaultQuotas, isAdmin]);

  const renderSystemDefaultQuotasTab = () => (
    <Card 
      title={formatMessage({ id: 'quota.system_default_quotas' })}
      extra={
        <Button
          type="primary"
          icon={<SettingOutlined />}
          onClick={handleEditSystemQuotas}
          loading={systemQuotasLoading}
        >
          <FormattedMessage id="action.edit" />
        </Button>
      }
    >
      {systemDefaultQuotas ? (
        <Row gutter={[16, 16]}>
          <Col span={6}>
            <Card size="small">
              <div style={{ textAlign: 'center' }}>
                <Typography.Title level={3} style={{ margin: 0 }}>
                  {systemDefaultQuotas.max_collection_count}
                </Typography.Title>
                <Typography.Text type="secondary">
                  {getQuotaTypeName('max_collection_count')}
                </Typography.Text>
              </div>
            </Card>
          </Col>
          <Col span={6}>
            <Card size="small">
              <div style={{ textAlign: 'center' }}>
                <Typography.Title level={3} style={{ margin: 0 }}>
                  {systemDefaultQuotas.max_document_count}
                </Typography.Title>
                <Typography.Text type="secondary">
                  {getQuotaTypeName('max_document_count')}
                </Typography.Text>
              </div>
            </Card>
          </Col>
          <Col span={6}>
            <Card size="small">
              <div style={{ textAlign: 'center' }}>
                <Typography.Title level={3} style={{ margin: 0 }}>
                  {systemDefaultQuotas.max_document_count_per_collection}
                </Typography.Title>
                <Typography.Text type="secondary">
                  {getQuotaTypeName('max_document_count_per_collection')}
                </Typography.Text>
              </div>
            </Card>
          </Col>
          <Col span={6}>
            <Card size="small">
              <div style={{ textAlign: 'center' }}>
                <Typography.Title level={3} style={{ margin: 0 }}>
                  {systemDefaultQuotas.max_bot_count}
                </Typography.Title>
                <Typography.Text type="secondary">
                  {getQuotaTypeName('max_bot_count')}
                </Typography.Text>
              </div>
            </Card>
          </Col>
        </Row>
      ) : (
        <Typography.Text type="secondary">
          <FormattedMessage id="quota.system_loading" />
        </Typography.Text>
      )}
    </Card>
  );

  const renderUserQuotasTab = () => (
    <>
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
          <Card title={formatMessage({ id: 'quota.my_quotas' })}>
            <Table
              rowKey="quota_type"
              bordered
              columns={userQuotaColumns}
              dataSource={currentUserQuota.quotas}
              loading={loading}
              pagination={false}
              size="middle"
            />
          </Card>
        )
      )}
    </>
  );

  return (
    <PageContainer>
      <PageHeader
        title={formatMessage({ id: 'quota.management' })}
        description={formatMessage({ id: 'quota.management_tips' })}
      >
        <RefreshButton loading={loading} onClick={getQuotas} />
      </PageHeader>

      {isAdmin ? (
        <Tabs
          defaultActiveKey="user_quotas"
          items={[
            {
              key: 'user_quotas',
              label: formatMessage({ id: 'quota.user_quotas' }),
              children: renderUserQuotasTab(),
            },
            {
              key: 'system_defaults',
              label: formatMessage({ id: 'quota.system_defaults' }),
              children: renderSystemDefaultQuotasTab(),
            },
          ]}
        />
      ) : (
        renderUserQuotasTab()
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

      <Modal
        title={formatMessage({ id: 'quota.edit_system_defaults' })}
        open={systemQuotasModalVisible}
        onCancel={() => setSystemQuotasModalVisible(false)}
        onOk={() => systemQuotasForm.submit()}
        destroyOnClose
        width={600}
      >
        <Form
          form={systemQuotasForm}
          layout="vertical"
          onFinish={handleUpdateSystemQuotas}
        >
          <Form.Item
            name="max_collection_count"
            label={getQuotaTypeName('max_collection_count')}
            rules={[
              { required: true },
              { type: 'number', min: 1 }
            ]}
          >
            <InputNumber
              min={1}
              style={{ width: '100%' }}
              placeholder={formatMessage({ id: 'quota.enter_default_limit' })}
            />
          </Form.Item>
          <Form.Item
            name="max_document_count"
            label={getQuotaTypeName('max_document_count')}
            rules={[
              { required: true },
              { type: 'number', min: 1 }
            ]}
          >
            <InputNumber
              min={1}
              style={{ width: '100%' }}
              placeholder={formatMessage({ id: 'quota.enter_default_limit' })}
            />
          </Form.Item>
          <Form.Item
            name="max_document_count_per_collection"
            label={getQuotaTypeName('max_document_count_per_collection')}
            rules={[
              { required: true },
              { type: 'number', min: 1 }
            ]}
          >
            <InputNumber
              min={1}
              style={{ width: '100%' }}
              placeholder={formatMessage({ id: 'quota.enter_default_limit' })}
            />
          </Form.Item>
          <Form.Item
            name="max_bot_count"
            label={getQuotaTypeName('max_bot_count')}
            rules={[
              { required: true },
              { type: 'number', min: 1 }
            ]}
          >
            <InputNumber
              min={1}
              style={{ width: '100%' }}
              placeholder={formatMessage({ id: 'quota.enter_default_limit' })}
            />
          </Form.Item>
        </Form>
      </Modal>
    </PageContainer>
  );
};
