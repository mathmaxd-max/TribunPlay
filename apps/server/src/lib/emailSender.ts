type ResendSendEmailInput = {
  apiKey: string | undefined;
  from: string | undefined;
  to: string;
  subject: string;
  html: string;
  text: string;
};

const requireConfigured = (value: string | undefined, message: string): string => {
  if (!value) throw new Error(message);
  return value;
};

export const sendResendEmail = async (input: ResendSendEmailInput): Promise<void> => {
  const apiKey = requireConfigured(input.apiKey, "Email service is not configured");
  const from = requireConfigured(input.from, "Email sender is not configured");

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from,
      to: input.to,
      subject: input.subject,
      html: input.html,
      text: input.text,
    }),
  });

  if (!response.ok) {
    // Keep message generic; providers may return detailed failures.
    throw new Error("Failed to send verification email");
  }
};

