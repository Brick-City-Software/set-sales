import type { ActionFunctionArgs, LoaderFunctionArgs, HeadersFunction } from "react-router";
import { useLoaderData, useSubmit, useNavigation, useRouteError, isRouteErrorResponse } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate, MONTHLY_PLAN } from "../shopify.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { billing } = await authenticate.admin(request);

  const { hasActivePayment, appSubscriptions } = await billing.check({
    plans: [MONTHLY_PLAN] as any,
    isTest: process.env.NODE_ENV !== "production",
  });

  const subscription = appSubscriptions[0] ?? null;

  return {
    hasActivePayment,
    subscription: subscription
      ? {
          id: subscription.id,
          name: subscription.name,
          createdAt: subscription.createdAt,
        }
      : null,
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { billing, session } = await authenticate.admin(request);
  const formData = await request.formData();
  const intent = formData.get("intent");

  if (intent === "subscribe") {
    await billing.request({
      plan: MONTHLY_PLAN as any,
      isTest: process.env.NODE_ENV !== "production",
      returnUrl: `https://${session.shop}/admin/apps/${process.env.SHOPIFY_API_KEY}`,
    });
  }

  if (intent === "cancel") {
    const subscriptionId = formData.get("subscriptionId") as string;
    await billing.cancel({
      subscriptionId,
      isTest: process.env.NODE_ENV !== "production",
      prorate: true,
    });
  }

  return null;
};

export default function BillingPage() {
  const { hasActivePayment, subscription } = useLoaderData<typeof loader>();
  const submit = useSubmit();
  const navigation = useNavigation();
  const isLoading = navigation.state !== "idle";

  const handleSubscribe = () => {
    submit({ intent: "subscribe" }, { method: "post" });
  };

  const handleCancel = () => {
    if (!subscription) return;
    submit(
      { intent: "cancel", subscriptionId: subscription.id },
      { method: "post" }
    );
  };

  return (
    <s-page heading="Billing">
      <s-stack gap="large">
        <s-section heading="Set Sales Monthly Plan">
          <s-stack gap="base">
            <s-stack direction="inline" gap="base" alignItems="center">
              <div style={{ fontSize: "32px", fontWeight: "bold" }}>$4.99</div>
              <div style={{ color: "var(--p-color-text-subdued)" }}>
                per month
              </div>
              {hasActivePayment ? (
                <s-badge tone="success">Active</s-badge>
              ) : (
                <s-badge tone="caution">Inactive</s-badge>
              )}
            </s-stack>

            <ul style={{ paddingLeft: "20px", margin: 0 }}>
              <s-list-item>14-day free trial — no charge until trial ends</s-list-item>
              <s-list-item>Put any products on sale with percentage, fixed amount, or fixed price discounts</s-list-item>
              <s-list-item>Automatically set compare-at prices so customers see the original price</s-list-item>
              <s-list-item>Track all active and ended sales in one place</s-list-item>
              <s-list-item>Up to 500 variants per sale</s-list-item>
            </ul>

            {hasActivePayment ? (
              <s-stack gap="base">
                {subscription && (
                  <div style={{ color: "var(--p-color-text-subdued)", fontSize: "14px" }}>
                    Subscribed since{" "}
                    {new Date(subscription.createdAt).toLocaleDateString("en-US", {
                      year: "numeric",
                      month: "long",
                      day: "numeric",
                    })}
                  </div>
                )}
                <div>
                  <s-button
                    tone="critical"
                    variant="tertiary"
                    disabled={isLoading}
                    onClick={handleCancel}
                  >
                    Cancel subscription
                  </s-button>
                </div>
              </s-stack>
            ) : (
              <div>
                <s-button
                  variant="primary"
                  disabled={isLoading}
                  onClick={handleSubscribe}
                >
                  Start 14-day free trial
                </s-button>
              </div>
            )}
          </s-stack>
        </s-section>
      </s-stack>
    </s-page>
  );
}

export function ErrorBoundary() {
  const error = useRouteError();

  return (
    <s-page heading="Billing Error">
      <s-banner tone="critical">
        <s-paragraph>
          {isRouteErrorResponse(error)
            ? `${error.status} ${error.statusText}`
            : error instanceof Error
            ? error.message
            : "An unexpected error occurred while loading billing information."}
        </s-paragraph>
      </s-banner>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
