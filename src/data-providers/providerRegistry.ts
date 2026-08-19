import type { ReportProviderId } from '../report-engine/schema/generation';
import type { ReportDataProvider } from './ReportDataProvider';
import { AscendixDataProvider } from './ascendix/AscendixDataProvider';
import { ExcelDataProvider } from './excel/ExcelDataProvider';
import { JsonDataProvider } from './json/JsonDataProvider';
import { SampleDataProvider } from './sample/SampleDataProvider';

const providers: Record<ReportProviderId, ReportDataProvider> = {sample:new SampleDataProvider(),json:new JsonDataProvider(),excel:new ExcelDataProvider(),ascendix:new AscendixDataProvider()};
export const getReportDataProvider = (id: ReportProviderId) => providers[id];

