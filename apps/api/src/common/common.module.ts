import { Global, Module } from '@nestjs/common';
import { AuditService } from './audit.service';
import { OutboxService } from './outbox.service';

@Global()
@Module({ providers: [AuditService, OutboxService], exports: [AuditService, OutboxService] })
export class CommonModule {}
