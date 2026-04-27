import { StatusCodes } from 'http-status-codes';
import nodemailer from 'nodemailer';
import ApiError from '../utils/ApiError.js';

let cachedTransporter = null;

const parseBoolean = (value, fallback = false) => {
  if (value === undefined || value === null || String(value).trim() === '') {
    return fallback;
  }
  return ['1', 'true', 'yes', 'on'].includes(String(value).trim().toLowerCase());
};

const resolveSmtpConfig = () => {
  const user = String(process.env.SMTP_USER || '').trim();
  const pass = String(process.env.SMTP_PASS || '').trim();
  const host = String(process.env.SMTP_HOST || '').trim() || 'smtp.gmail.com';
  const port = Number.parseInt(process.env.SMTP_PORT || '587', 10);
  const secure = parseBoolean(process.env.SMTP_SECURE, port === 465);
  const from = String(process.env.SMTP_FROM || '').trim() || user;

  return { user, pass, host, port, secure, from };
};

const getTransporter = () => {
  if (cachedTransporter) {
    return cachedTransporter;
  }

  const config = resolveSmtpConfig();
  if (!config.user || !config.pass) {
    throw new ApiError(
      StatusCodes.SERVICE_UNAVAILABLE,
      'Email service is not configured. Set SMTP_USER and SMTP_PASS.'
    );
  }

  cachedTransporter = nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: config.secure,
    auth: {
      user: config.user,
      pass: config.pass
    }
  });

  return cachedTransporter;
};

export const sendPasswordResetOtpEmail = async ({ toEmail, otpCode, expiresInMinutes }) => {
  const destination = String(toEmail || '').trim().toLowerCase();
  const otp = String(otpCode || '').trim();

  if (!destination || !otp) {
    throw new ApiError(StatusCodes.BAD_REQUEST, 'Email and OTP are required');
  }

  const { from } = resolveSmtpConfig();
  const transporter = getTransporter();

  const subject = 'Your password reset OTP';
  const text = [
    'Your OTP code is:',
    otp,
    '',
    `This code expires in ${expiresInMinutes} minute(s).`,
    'If you did not request a password reset, please ignore this email.'
  ].join('\n');

  const html = `
    <div style="font-family: Arial, sans-serif; color: #1f2937; line-height: 1.5;">
      <h2 style="margin-bottom: 8px;">Password Reset OTP</h2>
      <p style="margin: 0 0 14px;">Use this one-time code to reset your password:</p>
      <div style="font-size: 28px; font-weight: 700; letter-spacing: 4px; margin: 8px 0 14px;">
        ${otp}
      </div>
      <p style="margin: 0 0 8px;">This OTP expires in <strong>${expiresInMinutes} minute(s)</strong>.</p>
      <p style="margin: 0;">If you did not request this, you can safely ignore this email.</p>
    </div>
  `;

  try {
    await transporter.sendMail({
      from,
      to: destination,
      subject,
      text,
      html
    });
  } catch (error) {
    throw new ApiError(
      StatusCodes.SERVICE_UNAVAILABLE,
      process.env.NODE_ENV !== 'production'
        ? `Failed to send OTP email: ${error?.message || 'Unknown mail error'}`
        : 'Unable to send OTP email right now. Please try again.'
    );
  }
};

