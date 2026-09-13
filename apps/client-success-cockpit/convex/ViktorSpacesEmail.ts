import { Email } from "@convex-dev/auth/providers/Email";
import { APP_NAME } from "./constants";

declare const process: { env: Record<string, string | undefined> };

function generateOTP() {
  const array = new Uint32Array(1);
  crypto.getRandomValues(array);
  return String(array[0] % 1000000).padStart(6, "0");
}

async function sendEmail({
  email,
  token,
  subject,
  heading,
  description,
}: {
  email: string;
  token: string;
  subject: string;
  heading: string;
  description: string;
}) {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.AUTH_EMAIL_FROM || "onboarding@resend.dev";
  if (!apiKey) {
    throw new Error(
      "RESEND_API_KEY is not set on this deployment, so verification emails cannot be sent",
    );
  }

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      from,
      to: [email],
      subject: `${token} is your ${subject.toLowerCase()} code`,
      html: `
        <div style="font-family: sans-serif; max-width: 400px; margin: 0 auto; padding: 20px;">
          <h2 style="color: #333;">${heading}</h2>
          <p style="color: #666;">${description}</p>
          <div style="background: #f5f5f5; padding: 20px; text-align: center; border-radius: 8px; margin: 20px 0;">
            <span style="font-size: 36px; font-weight: bold; letter-spacing: 8px; color: #333;">${token}</span>
          </div>
          <p style="color: #999; font-size: 12px;">This code expires in 15 minutes and replaces any code sent before it.</p>
          <hr style="border: none; border-top: 1px solid #eee; margin: 20px 0;" />
          <p style="color: #999; font-size: 12px; text-align: center;">This email was sent by ${APP_NAME}</p>
        </div>
      `,
      text: `${heading}\n\n${description}\n\nYour code is: ${token}\n\nThis code expires in 15 minutes and replaces any code sent before it.\n\n---\nThis email was sent by ${APP_NAME}`,
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Failed to send email: ${error}`);
  }
}

/**
 * Email verification provider for sign-up flow.
 * Sends OTP codes through Resend (RESEND_API_KEY, AUTH_EMAIL_FROM).
 */
export const ViktorSpacesEmail = Email({
  id: "viktor-spaces-email",
  maxAge: 60 * 15, // 15 minutes

  async generateVerificationToken() {
    return generateOTP();
  },

  async sendVerificationRequest({ identifier: email, token }) {
    await sendEmail({
      email,
      token,
      subject: "Mahara sign-up",
      heading: "Verify your email",
      description: "Your verification code is:",
    });
  },
});

/**
 * Password reset email provider.
 * Same Resend transport, different template.
 */
export const ViktorSpacesPasswordReset = Email({
  id: "viktor-spaces-password-reset",
  maxAge: 60 * 15, // 15 minutes

  async generateVerificationToken() {
    return generateOTP();
  },

  async sendVerificationRequest({ identifier: email, token }) {
    await sendEmail({
      email,
      token,
      subject: "Mahara password reset",
      heading: "Reset your password",
      description: "Your password reset code is:",
    });
  },
});
