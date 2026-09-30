import { IsIn } from 'class-validator';
import { DASHBOARD_RANGES, DashboardRange } from '../dashboard-metric.service';

export class DashboardRangeQueryDto {
  @IsIn(DASHBOARD_RANGES)
  range: DashboardRange;
}
