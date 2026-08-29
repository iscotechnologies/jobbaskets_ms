import { IsArray, IsBoolean, IsNotEmpty, IsNumber, IsOptional, IsString } from 'class-validator';

export class JobPublishedPayloadDto {
  @IsNotEmpty()
  @IsNumber()
  job_id!: number;

  @IsNotEmpty()
  @IsString()
  uuid!: string;

  @IsNotEmpty()
  @IsString()
  title!: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsNotEmpty()
  @IsString()
  company_name!: string;

  @IsOptional()
  @IsString()
  company_logo?: string;

  @IsOptional()
  @IsString()
  image_url?: string;

  @IsOptional()
  @IsString()
  banner_url?: string;

  @IsOptional()
  @IsString()
  employment_type?: string;

  @IsOptional()
  @IsString()
  work_type?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  locations?: string[];

  @IsOptional()
  @IsNumber()
  salary_min?: number;

  @IsOptional()
  @IsNumber()
  salary_max?: number;

  @IsOptional()
  @IsString()
  salary_currency?: string;

  @IsOptional()
  @IsString()
  salary_type?: string;

  @IsOptional()
  @IsBoolean()
  show_salary?: boolean;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  skills?: string[];

  @IsOptional()
  @IsString()
  experience_required?: string;

  @IsOptional()
  @IsString()
  job_url?: string;

  @IsOptional()
  @IsString()
  posted_at?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  target_platforms?: string[];
}
