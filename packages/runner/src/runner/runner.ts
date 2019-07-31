// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
import { Message, Queue } from 'azure-services';
import { inject, injectable } from 'inversify';
import { isNil } from 'lodash';
import { Logger } from 'logger';
import { Browser } from 'puppeteer';
import { CrawlerTask } from '../tasks/crawler-task';
import { DataFactoryTask } from '../tasks/data-factory-task';
import { PageStateUpdaterTask } from '../tasks/page-state-updater-task';
import { ScannerTask } from '../tasks/scanner-task';
import { StorageTask } from '../tasks/storage-task';
import { WebDriverTask } from '../tasks/web-driver-task';
import { WebsiteStateUpdaterTask } from '../tasks/website-state-updater-task';
import { ScanMetadata } from '../types/scan-metadata';
@injectable()
export class Runner {
    constructor(
        @inject(CrawlerTask) private readonly crawlerTask: CrawlerTask,
        @inject(ScannerTask) private readonly scannerTask: ScannerTask,
        @inject(WebsiteStateUpdaterTask) private readonly websiteStateUpdaterTask: WebsiteStateUpdaterTask,
        @inject(DataFactoryTask) private readonly dataFactoryTask: DataFactoryTask,
        @inject(WebDriverTask) private readonly webDriverTask: WebDriverTask,
        @inject(StorageTask) private readonly storageTask: StorageTask,
        @inject(Queue) private readonly queue: Queue,
        @inject(PageStateUpdaterTask) private readonly pageStateUpdaterTask: PageStateUpdaterTask,
        @inject(Logger) private readonly logger: Logger,
    ) {}

    public async run(): Promise<void> {
        const startTime = Date.now();
        let processedMessages = 0;

        try {
            // tslint:disable-next-line: no-constant-condition
            while (true) {
                console.log('fetching message from queue');
                const messages = await this.queue.getMessages(this.queue.scanQueue, 3);
                console.log('fetched messages from queue - ', messages.length);

                if (messages.length === 0) {
                    break;
                }

                for (const message of messages) {
                    try {
                        console.log(`scanning for message ${message.messageText}`);
                        const scanMetadata = this.getScanMessageData(message);

                        await this.runScan(scanMetadata);

                        await this.queue.deleteMessage(message);
                    } catch (e) {
                        console.log(`error occurred for message ${JSON.stringify(message)}`, e);
                    }
                    processedMessages += 1;
                }

                console.log(`processed ${processedMessages} messages in ${this.getElapsedTimeInSec(startTime)} seconds ...`);

                if (processedMessages >= 200) {
                    break;
                }
            }
        } catch (e) {
            console.log('exception occurred in runner - ', e);
            throw e;
        }

        console.log('successfully completed runner task');
    }

    private getScanMessageData(message: Message): ScanMetadata {
        const scanMetadata = JSON.parse(message.messageText) as ScanMetadata;
        if (isNil(scanMetadata.scanUrl)) {
            // tslint:disable-next-line: no-unsafe-any no-any
            scanMetadata.scanUrl = (scanMetadata as any).url;
        }
        if (isNil(scanMetadata.websiteName)) {
            // tslint:disable-next-line: no-unsafe-any no-any
            scanMetadata.websiteName = (scanMetadata as any).name;
        }

        return scanMetadata;
    }

    private async runScan(scanMetadata: ScanMetadata): Promise<void> {
        const scanStartTime = Date.now();

        try {
            let browser: Browser;
            const runTime = new Date();
            // set scanned page run state to running
            this.logger.logInfo('Setting to running state on page document');
            await this.pageStateUpdaterTask.setRunningState(scanMetadata, runTime);

            // start new web driver process
            browser = await this.webDriverTask.launch();
            console.log(`browser launched. Elapsed time - ${this.getElapsedTimeInSec(scanStartTime)}`);

            // scan website page for next level pages references
            const crawlerScanResults = await this.crawlerTask.crawl(scanMetadata.scanUrl, scanMetadata.baseUrl, browser);
            this.logger.logInfo(`Completed crawling ${scanMetadata.scanUrl}`);
            console.log(`Crawling completed. Elapsed time - ${this.getElapsedTimeInSec(scanStartTime)}`);

            // convert pages references to a storage model
            const websitePages = this.dataFactoryTask.toWebsitePagesModel(crawlerScanResults, scanMetadata, runTime);

            // upsert pages references model in a storage
            this.logger.logInfo('Storing found pages');
            await this.storageTask.mergeResults(websitePages, scanMetadata.websiteId);
            console.log(`Stored found pages - ${this.getElapsedTimeInSec(scanStartTime)}`);

            // update scanned page with on-page links
            this.logger.logInfo('Storing direct links of the page in the page document');
            await this.pageStateUpdaterTask.setPageLinks(crawlerScanResults, scanMetadata);
            console.log(`Stored direct links of pages - ${this.getElapsedTimeInSec(scanStartTime)}`);

            // scan website page for accessibility issues
            const axeScanResults = await this.scannerTask.scan(scanMetadata.scanUrl);
            console.log(`Axe scan completed - ${this.getElapsedTimeInSec(scanStartTime)}`);
            // convert accessibility issues to a storage model

            const issueScanResults = this.dataFactoryTask.toScanResultsModel(axeScanResults, scanMetadata);
            // store accessibility issues model in a storage
            this.logger.logInfo(`Storing accessibility issues found in page ${scanMetadata.scanUrl}`);
            await this.storageTask.writeResults(issueScanResults.results, scanMetadata.websiteId);
            console.log(`Stored issues - elapsed time - ${this.getElapsedTimeInSec(scanStartTime)}`);

            // convert scan results to a page scan history storage model
            const pageScanResult = this.dataFactoryTask.toPageScanResultModel(crawlerScanResults, issueScanResults, scanMetadata, runTime);
            // store page scan history model in a storage
            this.logger.logInfo(`Storing page scan result information for ${scanMetadata.scanUrl}`);
            await this.storageTask.writeResult(pageScanResult, scanMetadata.websiteId);

            // set scanned page run state to corresponding page run result
            this.logger.logInfo(`Setting page scan result state on the page document`);
            await this.pageStateUpdaterTask.setCompleteState(pageScanResult, scanMetadata, runTime);

            // update website root scan state document with last page scan result
            this.logger.logInfo(`Updating last page scan result of the current page on the website document`);
            await this.websiteStateUpdaterTask.update(pageScanResult, scanMetadata, runTime);
        } finally {
            await this.webDriverTask.close();
            console.log(`Scan for message completed - elapsed time - ${this.getElapsedTimeInSec(scanStartTime)}`);
        }
    }

    private getElapsedTimeInSec(startTime: number): number {
        return (Date.now() - startTime) / 1000;
    }
}
