import { useEffect } from 'react';
import { useNavigate, useSearchParams } from 'umi';
import { Spin } from 'antd';
import { PageContainer } from '@/components';

const OAuthCallback = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  useEffect(() => {
    const handleOAuth = async () => {
      try {
        // Get the query parameters from the URL
        const query = window.location.search;

        // Determine which OAuth provider based on the referrer or state
        // For now, we'll check if it's GitHub or Google based on the URL
        let provider = 'github'; // default to github

        // You could also use state parameter to determine the provider
        const state = searchParams.get('state');
        if (state && state.includes('google')) {
          provider = 'google';
        }

        // Make request to the backend OAuth callback endpoint
        const callbackUrl = `/api/v1/auth/${provider}/callback${query}`;

        const response = await fetch(callbackUrl, {
          method: 'GET',
          headers: {
            'Content-Type': 'application/json',
          },
          credentials: 'include', // Important for cookies
        });

        if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`);
        }

        // fastapi-users OAuth callback returns 204 No Content on success
        // The authentication is handled via cookies, so we don't need to parse JSON
        if (response.status === 204) {
          // Authentication successful, redirect to main application
          navigate('/');
        } else {
          // Try to parse JSON response for other status codes
          try {
            const data = await response.json();

            // The response should contain the access token
            if (data.access_token) {
              // Store the token in localStorage (optional, since we're using cookies)
              localStorage.setItem('authToken', data.access_token);
              localStorage.setItem('tokenType', data.token_type || 'bearer');
            }

            // Redirect to the main application
            navigate('/');
          } catch (jsonError) {
            // If JSON parsing fails, still redirect to main page
            navigate('/');
          }
        }
      } catch (error) {
        console.error('Error handling OAuth callback:', error);
        // Redirect to login page on error
        navigate('/accounts/signin');
      }
    };

    handleOAuth();
  }, [navigate, searchParams]);

  return (
    <PageContainer
      height="fixed"
      width="auto"
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexDirection: 'column',
        gap: 16,
      }}
    >
      <Spin size="large" />
      <div>Processing OAuth login...</div>
    </PageContainer>
  );
};

export default OAuthCallback;
