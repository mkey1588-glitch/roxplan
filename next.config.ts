import type { NextConfig } from 'next';
import createNextIntlPlugin from 'next-intl/plugin';

// Resolves ./i18n/request.ts by default (DECISIONS.md D5).
const withNextIntl = createNextIntlPlugin();

const nextConfig: NextConfig = {};

export default withNextIntl(nextConfig);
