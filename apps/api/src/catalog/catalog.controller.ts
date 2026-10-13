import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { BudgetEstimateSchema, ListingSearchSchema, type BudgetEstimateInput, type ListingSearchInput } from '@utsavora/validation';
import { Public } from '../auth/actor';
import { ZodBody, ZodPipe } from '../common/zod';
import { CatalogService } from './catalog.service';

@ApiTags('catalogue')
@Public()
@Controller()
export class CatalogController {
  constructor(private readonly catalog: CatalogService) {}

  @Get('occasions')
  occasions() {
    return this.catalog.occasions();
  }

  @Get('categories')
  categories() {
    return this.catalog.categories();
  }

  @Get('service-areas')
  serviceAreas() {
    return this.catalog.serviceAreas();
  }

  @Get('listings')
  listings(@Query(new ZodPipe(ListingSearchSchema)) q: ListingSearchInput) {
    return this.catalog.searchListings(q);
  }

  @Get('listings/:id')
  listing(@Param('id', ParseUUIDPipe) id: string) {
    return this.catalog.listing(id);
  }

  @Get('vendors/:slug')
  vendor(@Param('slug') slug: string) {
    return this.catalog.vendorProfile(slug);
  }

  @HttpCode(200)
  @Post('estimates/budget')
  @ZodBody(BudgetEstimateSchema)
  estimate(@Body(new ZodPipe(BudgetEstimateSchema)) body: BudgetEstimateInput) {
    return this.catalog.estimate(body);
  }
}
