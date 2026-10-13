import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Post, Put, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import {
  ListingSchema,
  PageQuerySchema,
  QuoteRevisionSchema,
  ReasonSchema,
  VendorProfileSchema,
  z,
  type ListingInput,
  type QuoteRevisionInput,
  type ReasonInput,
  type VendorProfileInput,
} from '@utsavora/validation';
import { CurrentActor, Roles, type Actor } from '../auth/actor';
import { ZodBody, ZodPipe } from '../common/zod';
import { WriteThrottle } from '../common/throttle';
import { QuotesService } from '../quotes/quotes.service';
import { VendorService } from './vendor.service';

const InboxQuery = PageQuerySchema.extend({ status: z.enum(['new', 'quoted', 'won', 'closed']).optional() });

@ApiTags('vendor')
@Roles('VENDOR')
@Controller('vendor')
export class VendorController {
  constructor(
    private readonly vendor: VendorService,
    private readonly quotes: QuotesService,
  ) {}

  @Get('me')
  me(@CurrentActor() actor: Actor) {
    return this.vendor.profile(actor);
  }

  @Put('me')
  @ZodBody(VendorProfileSchema)
  update(@CurrentActor() actor: Actor, @Body(new ZodPipe(VendorProfileSchema)) body: VendorProfileInput) {
    return this.vendor.updateProfile(actor, body);
  }

  @HttpCode(200)
  @Post('me/submit')
  submit(@CurrentActor() actor: Actor) {
    return this.vendor.submitForReview(actor);
  }

  @Get('dashboard')
  dashboard(@CurrentActor() actor: Actor) {
    return this.vendor.dashboard(actor);
  }

  // Listings (menus, packages, services)
  @Get('listings')
  listings(@CurrentActor() actor: Actor) {
    return this.vendor.listListings(actor);
  }

  @Post('listings')
  @ZodBody(ListingSchema)
  createListing(@CurrentActor() actor: Actor, @Body(new ZodPipe(ListingSchema)) body: ListingInput) {
    return this.vendor.createListing(actor, body);
  }

  @Put('listings/:id')
  @ZodBody(ListingSchema)
  updateListing(@CurrentActor() actor: Actor, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(ListingSchema)) body: ListingInput) {
    return this.vendor.updateListing(actor, id, body);
  }

  @HttpCode(200)
  @Post('listings/:id/submit')
  submitListing(@CurrentActor() actor: Actor, @Param('id', ParseUUIDPipe) id: string) {
    return this.vendor.submitListing(actor, id);
  }

  @Delete('listings/:id')
  deleteListing(@CurrentActor() actor: Actor, @Param('id', ParseUUIDPipe) id: string) {
    return this.vendor.deleteListing(actor, id);
  }

  // Quote inbox
  @Get('quotes')
  inbox(@CurrentActor() actor: Actor, @Query(new ZodPipe(InboxQuery)) q: z.infer<typeof InboxQuery>) {
    return this.quotes.vendorInbox(actor, q.status, q.page, q.pageSize);
  }

  @Get('quotes/:id')
  quote(@CurrentActor() actor: Actor, @Param('id', ParseUUIDPipe) id: string) {
    return this.quotes.vendorQuoteDetail(actor, id);
  }

  @HttpCode(200)
  @Post('quotes/:id/review')
  review(@CurrentActor() actor: Actor, @Param('id', ParseUUIDPipe) id: string) {
    return this.quotes.markReviewing(actor, id);
  }

  @WriteThrottle()
  @Post('quotes/:id/revisions')
  @ZodBody(QuoteRevisionSchema)
  revise(@CurrentActor() actor: Actor, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(QuoteRevisionSchema)) body: QuoteRevisionInput) {
    return this.quotes.submitRevision(actor, id, body);
  }

  @HttpCode(200)
  @Post('quotes/:id/decline')
  @ZodBody(ReasonSchema)
  decline(@CurrentActor() actor: Actor, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(ReasonSchema)) body: ReasonInput) {
    return this.quotes.decline(actor, id, body);
  }

  @HttpCode(200)
  @Post('quotes/:id/withdraw')
  @ZodBody(ReasonSchema)
  withdraw(@CurrentActor() actor: Actor, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(ReasonSchema)) body: ReasonInput) {
    return this.quotes.withdraw(actor, id, body);
  }
}
