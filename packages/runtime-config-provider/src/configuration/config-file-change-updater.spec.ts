// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
import 'reflect-metadata';

import * as storageBlob from '@azure/storage-blob';
import { Credentials, CredentialsProvider } from 'credentials-provider';
import { IMock, Mock } from 'typemoq';
import { ConfigFileChangeNotifier } from './config-file-updater';

// tslint:disable: no-any

describe(ConfigFileChangeNotifier, () => {
    let testSubject: ConfigFileChangeNotifier;
    let credentialsProviderMock: IMock<CredentialsProvider>;
    let credentialsStub: Credentials;

    beforeEach(() => {
        credentialsProviderMock = Mock.ofType(CredentialsProvider);

        credentialsStub = 'credentials 1' as any;

        credentialsProviderMock.setup(async c => c.getCredentialsForStorage()).returns(async () => credentialsStub);

        testSubject = new ConfigFileChangeNotifier(credentialsProviderMock.object);
    });

    it('invokes subscriber after subscribing', async () => {
        let callbackInvoked: boolean;

        const callback = async (filePath: string) => {
            callbackInvoked = true;
        };

        await testSubject.subscribe(callback);

        expect(callbackInvoked).toBe(true);
    });

    it('invokes subscriber on file change in blob', async () => {});
});
