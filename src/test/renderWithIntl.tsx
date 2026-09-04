import { render as testingLibraryRender, type RenderOptions } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { ReactElement } from "react";
import messages from "@/i18n/messages/en.json";

export function renderWithIntl(ui: ReactElement, options?: RenderOptions) {
  return testingLibraryRender(
    <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
      {ui}
    </NextIntlClientProvider>,
    options,
  );
}
