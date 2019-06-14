// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
import { Queue, StorageConfig } from 'azure-services';
import { inject, injectable } from 'inversify';
import { WebSite } from '../request-type/website';

@injectable()
export class ScanRequestSender {
    constructor(@inject(Queue) private readonly queue: Queue, @inject(StorageConfig) private readonly storageConfig: StorageConfig) {}
    public async sendRequestToScan(websites: WebSite[]): Promise<void> {
        await Promise.all(
            websites.map(async message => {
                await this.queue.createMessage(this.storageConfig.scanQueue, message);
            }),
        );
    }
}
