// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import { CredentialsProvider } from 'credentials-provider';
import { inject, injectable } from 'inversify';

@injectable()
export class ConfigFileChangeNotifier {
    public static filePath = `${__dirname}/runtime-config.json`;

    constructor(@inject(CredentialsProvider) private readonly credentialsProvider: CredentialsProvider) {}

    public async subscribe(callback: (filePath: string) => Promise<void>): Promise<void> {
        await callback(ConfigFileChangeNotifier.filePath);
    }
}
