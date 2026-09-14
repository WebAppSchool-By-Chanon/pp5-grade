export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      academic_years: {
        Row: {
          created_at: string | null
          current_semester: number
          end_date: string | null
          id: string
          is_current: boolean | null
          start_date: string | null
          updated_at: string | null
          year_be: number
        }
        Insert: {
          created_at?: string | null
          current_semester?: number
          end_date?: string | null
          id?: string
          is_current?: boolean | null
          start_date?: string | null
          updated_at?: string | null
          year_be: number
        }
        Update: {
          created_at?: string | null
          current_semester?: number
          end_date?: string | null
          id?: string
          is_current?: boolean | null
          start_date?: string | null
          updated_at?: string | null
          year_be?: number
        }
        Relationships: []
      }
      announcements: {
        Row: {
          classroom_id: string | null
          content: string | null
          expires_at: string | null
          id: string
          is_active: boolean | null
          posted_at: string | null
          teacher_id: string | null
          title: string
        }
        Insert: {
          classroom_id?: string | null
          content?: string | null
          expires_at?: string | null
          id?: string
          is_active?: boolean | null
          posted_at?: string | null
          teacher_id?: string | null
          title: string
        }
        Update: {
          classroom_id?: string | null
          content?: string | null
          expires_at?: string | null
          id?: string
          is_active?: boolean | null
          posted_at?: string | null
          teacher_id?: string | null
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "announcements_classroom_id_fkey"
            columns: ["classroom_id"]
            isOneToOne: false
            referencedRelation: "classrooms"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "announcements_classroom_id_fkey"
            columns: ["classroom_id"]
            isOneToOne: false
            referencedRelation: "v_classroom_names"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "announcements_teacher_id_fkey"
            columns: ["teacher_id"]
            isOneToOne: false
            referencedRelation: "teachers"
            referencedColumns: ["id"]
          },
        ]
      }
      attendance: {
        Row: {
          classroom_id: string
          date: string
          id: string
          notes: string | null
          recorded_at: string | null
          recorded_by: string | null
          status: Database["public"]["Enums"]["attendance_status"]
          student_id: string
        }
        Insert: {
          classroom_id: string
          date: string
          id?: string
          notes?: string | null
          recorded_at?: string | null
          recorded_by?: string | null
          status: Database["public"]["Enums"]["attendance_status"]
          student_id: string
        }
        Update: {
          classroom_id?: string
          date?: string
          id?: string
          notes?: string | null
          recorded_at?: string | null
          recorded_by?: string | null
          status?: Database["public"]["Enums"]["attendance_status"]
          student_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "attendance_classroom_id_fkey"
            columns: ["classroom_id"]
            isOneToOne: false
            referencedRelation: "classrooms"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "attendance_classroom_id_fkey"
            columns: ["classroom_id"]
            isOneToOne: false
            referencedRelation: "v_classroom_names"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "attendance_recorded_by_fkey"
            columns: ["recorded_by"]
            isOneToOne: false
            referencedRelation: "teachers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "attendance_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "students"
            referencedColumns: ["id"]
          },
        ]
      }
      characteristic_evaluations: {
        Row: {
          academic_year_id: string
          characteristic_id: string
          evaluated_at: string | null
          evaluated_by: string | null
          id: string
          score: number | null
          semester: number
          student_id: string
        }
        Insert: {
          academic_year_id: string
          characteristic_id: string
          evaluated_at?: string | null
          evaluated_by?: string | null
          id?: string
          score?: number | null
          semester: number
          student_id: string
        }
        Update: {
          academic_year_id?: string
          characteristic_id?: string
          evaluated_at?: string | null
          evaluated_by?: string | null
          id?: string
          score?: number | null
          semester?: number
          student_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "characteristic_evaluations_academic_year_id_fkey"
            columns: ["academic_year_id"]
            isOneToOne: false
            referencedRelation: "academic_years"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "characteristic_evaluations_characteristic_id_fkey"
            columns: ["characteristic_id"]
            isOneToOne: false
            referencedRelation: "characteristics"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "characteristic_evaluations_evaluated_by_fkey"
            columns: ["evaluated_by"]
            isOneToOne: false
            referencedRelation: "teachers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "characteristic_evaluations_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "students"
            referencedColumns: ["id"]
          },
        ]
      }
      characteristics: {
        Row: {
          created_at: string | null
          id: string
          is_active: boolean | null
          name: string
          sort_order: number
          source: string | null
        }
        Insert: {
          created_at?: string | null
          id?: string
          is_active?: boolean | null
          name: string
          sort_order: number
          source?: string | null
        }
        Update: {
          created_at?: string | null
          id?: string
          is_active?: boolean | null
          name?: string
          sort_order?: number
          source?: string | null
        }
        Relationships: []
      }
      classrooms: {
        Row: {
          academic_year_id: string
          created_at: string | null
          grade_level_id: string
          id: string
          number_mode: string | null
          room_number: number
          status: Database["public"]["Enums"]["classroom_status"] | null
          study_plan_id: string | null
          updated_at: string | null
        }
        Insert: {
          academic_year_id: string
          created_at?: string | null
          grade_level_id: string
          id?: string
          number_mode?: string | null
          room_number: number
          status?: Database["public"]["Enums"]["classroom_status"] | null
          study_plan_id?: string | null
          updated_at?: string | null
        }
        Update: {
          academic_year_id?: string
          created_at?: string | null
          grade_level_id?: string
          id?: string
          number_mode?: string | null
          room_number?: number
          status?: Database["public"]["Enums"]["classroom_status"] | null
          study_plan_id?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "classrooms_academic_year_id_fkey"
            columns: ["academic_year_id"]
            isOneToOne: false
            referencedRelation: "academic_years"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "classrooms_grade_level_id_fkey"
            columns: ["grade_level_id"]
            isOneToOne: false
            referencedRelation: "grade_levels"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fk_classrooms_study_plan"
            columns: ["study_plan_id"]
            isOneToOne: false
            referencedRelation: "study_plans"
            referencedColumns: ["id"]
          },
        ]
      }
      competency_evaluations: {
        Row: {
          academic_year_id: string
          communication_score: number | null
          evaluated_at: string | null
          evaluated_by: string | null
          id: string
          life_skills_score: number | null
          problem_solving_score: number | null
          semester: number
          student_id: string
          technology_score: number | null
          thinking_score: number | null
        }
        Insert: {
          academic_year_id: string
          communication_score?: number | null
          evaluated_at?: string | null
          evaluated_by?: string | null
          id?: string
          life_skills_score?: number | null
          problem_solving_score?: number | null
          semester: number
          student_id: string
          technology_score?: number | null
          thinking_score?: number | null
        }
        Update: {
          academic_year_id?: string
          communication_score?: number | null
          evaluated_at?: string | null
          evaluated_by?: string | null
          id?: string
          life_skills_score?: number | null
          problem_solving_score?: number | null
          semester?: number
          student_id?: string
          technology_score?: number | null
          thinking_score?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "competency_evaluations_academic_year_id_fkey"
            columns: ["academic_year_id"]
            isOneToOne: false
            referencedRelation: "academic_years"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "competency_evaluations_evaluated_by_fkey"
            columns: ["evaluated_by"]
            isOneToOne: false
            referencedRelation: "teachers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "competency_evaluations_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "students"
            referencedColumns: ["id"]
          },
        ]
      }
      enrollments: {
        Row: {
          classroom_id: string
          created_at: string | null
          id: string
          semester: number
          student_id: string
          student_number: number
        }
        Insert: {
          classroom_id: string
          created_at?: string | null
          id?: string
          semester?: number
          student_id: string
          student_number: number
        }
        Update: {
          classroom_id?: string
          created_at?: string | null
          id?: string
          semester?: number
          student_id?: string
          student_number?: number
        }
        Relationships: [
          {
            foreignKeyName: "enrollments_classroom_id_fkey"
            columns: ["classroom_id"]
            isOneToOne: false
            referencedRelation: "classrooms"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "enrollments_classroom_id_fkey"
            columns: ["classroom_id"]
            isOneToOne: false
            referencedRelation: "v_classroom_names"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "enrollments_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "students"
            referencedColumns: ["id"]
          },
        ]
      }
      grade_levels: {
        Row: {
          code: string
          created_at: string | null
          id: string
          name_short: string
          name_th: string
          sort_order: number
          system: Database["public"]["Enums"]["school_system"]
        }
        Insert: {
          code: string
          created_at?: string | null
          id?: string
          name_short: string
          name_th: string
          sort_order: number
          system: Database["public"]["Enums"]["school_system"]
        }
        Update: {
          code?: string
          created_at?: string | null
          id?: string
          name_short?: string
          name_th?: string
          sort_order?: number
          system?: Database["public"]["Enums"]["school_system"]
        }
        Relationships: []
      }
      grade_scales: {
        Row: {
          created_at: string | null
          grade: number
          id: string
          max_score: number
          min_score: number
          sort_order: number
        }
        Insert: {
          created_at?: string | null
          grade: number
          id?: string
          max_score: number
          min_score: number
          sort_order: number
        }
        Update: {
          created_at?: string | null
          grade?: number
          id?: string
          max_score?: number
          min_score?: number
          sort_order?: number
        }
        Relationships: []
      }
      grades: {
        Row: {
          finalized_at: string | null
          grade: number | null
          grading_period: Database["public"]["Enums"]["grading_period"]
          id: string
          is_incomplete: boolean | null
          is_no_eligibility: boolean | null
          manual_override: boolean | null
          offering_id: string
          pass_fail: Database["public"]["Enums"]["pass_fail_result"] | null
          student_id: string
          total_score: number | null
          updated_at: string | null
        }
        Insert: {
          finalized_at?: string | null
          grade?: number | null
          grading_period: Database["public"]["Enums"]["grading_period"]
          id?: string
          is_incomplete?: boolean | null
          is_no_eligibility?: boolean | null
          manual_override?: boolean | null
          offering_id: string
          pass_fail?: Database["public"]["Enums"]["pass_fail_result"] | null
          student_id: string
          total_score?: number | null
          updated_at?: string | null
        }
        Update: {
          finalized_at?: string | null
          grade?: number | null
          grading_period?: Database["public"]["Enums"]["grading_period"]
          id?: string
          is_incomplete?: boolean | null
          is_no_eligibility?: boolean | null
          manual_override?: boolean | null
          offering_id?: string
          pass_fail?: Database["public"]["Enums"]["pass_fail_result"] | null
          student_id?: string
          total_score?: number | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "grades_offering_id_fkey"
            columns: ["offering_id"]
            isOneToOne: false
            referencedRelation: "subject_offerings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "grades_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "students"
            referencedColumns: ["id"]
          },
        ]
      }
      holidays: {
        Row: {
          academic_year_id: string | null
          created_at: string | null
          date: string
          id: string
          name: string
          type: Database["public"]["Enums"]["holiday_type"]
        }
        Insert: {
          academic_year_id?: string | null
          created_at?: string | null
          date: string
          id?: string
          name: string
          type: Database["public"]["Enums"]["holiday_type"]
        }
        Update: {
          academic_year_id?: string | null
          created_at?: string | null
          date?: string
          id?: string
          name?: string
          type?: Database["public"]["Enums"]["holiday_type"]
        }
        Relationships: [
          {
            foreignKeyName: "holidays_academic_year_id_fkey"
            columns: ["academic_year_id"]
            isOneToOne: false
            referencedRelation: "academic_years"
            referencedColumns: ["id"]
          },
        ]
      }
      homeroom_assignments: {
        Row: {
          assigned_at: string | null
          classroom_id: string
          id: string
          role: Database["public"]["Enums"]["homeroom_role"]
          teacher_id: string
        }
        Insert: {
          assigned_at?: string | null
          classroom_id: string
          id?: string
          role?: Database["public"]["Enums"]["homeroom_role"]
          teacher_id: string
        }
        Update: {
          assigned_at?: string | null
          classroom_id?: string
          id?: string
          role?: Database["public"]["Enums"]["homeroom_role"]
          teacher_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "homeroom_assignments_classroom_id_fkey"
            columns: ["classroom_id"]
            isOneToOne: false
            referencedRelation: "classrooms"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "homeroom_assignments_classroom_id_fkey"
            columns: ["classroom_id"]
            isOneToOne: false
            referencedRelation: "v_classroom_names"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "homeroom_assignments_teacher_id_fkey"
            columns: ["teacher_id"]
            isOneToOne: false
            referencedRelation: "teachers"
            referencedColumns: ["id"]
          },
        ]
      }
      learning_areas: {
        Row: {
          code: string
          id: string
          name_th: string
          sort_order: number
        }
        Insert: {
          code: string
          id?: string
          name_th: string
          sort_order: number
        }
        Update: {
          code?: string
          id?: string
          name_th?: string
          sort_order?: number
        }
        Relationships: []
      }
      parent_student_links: {
        Row: {
          created_at: string | null
          id: string
          is_primary: boolean | null
          parent_id: string
          relationship: Database["public"]["Enums"]["parent_relationship"] | null
          student_id: string
        }
        Insert: {
          created_at?: string | null
          id?: string
          is_primary?: boolean | null
          parent_id: string
          relationship?: Database["public"]["Enums"]["parent_relationship"] | null
          student_id: string
        }
        Update: {
          created_at?: string | null
          id?: string
          is_primary?: boolean | null
          parent_id?: string
          relationship?: Database["public"]["Enums"]["parent_relationship"] | null
          student_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "parent_student_links_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "parents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "parent_student_links_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "students"
            referencedColumns: ["id"]
          },
        ]
      }
      parents: {
        Row: {
          created_at: string | null
          email: string | null
          full_name: string
          id: string
          is_active: boolean | null
          line_id: string | null
          phone: string | null
          title: string | null
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          email?: string | null
          full_name: string
          id?: string
          is_active?: boolean | null
          line_id?: string | null
          phone?: string | null
          title?: string | null
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          email?: string | null
          full_name?: string
          id?: string
          is_active?: boolean | null
          line_id?: string | null
          phone?: string | null
          title?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
      reading_thinking_evaluations: {
        Row: {
          academic_year_id: string
          evaluated_at: string | null
          evaluated_by: string | null
          id: string
          reading_score: number | null
          semester: number
          student_id: string
          thinking_score: number | null
          writing_score: number | null
        }
        Insert: {
          academic_year_id: string
          evaluated_at?: string | null
          evaluated_by?: string | null
          id?: string
          reading_score?: number | null
          semester: number
          student_id: string
          thinking_score?: number | null
          writing_score?: number | null
        }
        Update: {
          academic_year_id?: string
          evaluated_at?: string | null
          evaluated_by?: string | null
          id?: string
          reading_score?: number | null
          semester?: number
          student_id?: string
          thinking_score?: number | null
          writing_score?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "reading_thinking_evaluations_academic_year_id_fkey"
            columns: ["academic_year_id"]
            isOneToOne: false
            referencedRelation: "academic_years"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reading_thinking_evaluations_evaluated_by_fkey"
            columns: ["evaluated_by"]
            isOneToOne: false
            referencedRelation: "teachers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reading_thinking_evaluations_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "students"
            referencedColumns: ["id"]
          },
        ]
      }
      schools: {
        Row: {
          academic_head_name: string | null
          address: string | null
          affiliation: string | null
          assessment_officer_name: string | null
          created_at: string | null
          deputy_director_name: string | null
          director_name: string | null
          director_title: string | null
          district: string | null
          id: string
          license_key: string | null
          logo_url: string | null
          name_en: string | null
          name_th: string
          phone: string | null
          province: string | null
          updated_at: string | null
        }
        Insert: {
          academic_head_name?: string | null
          address?: string | null
          affiliation?: string | null
          assessment_officer_name?: string | null
          created_at?: string | null
          deputy_director_name?: string | null
          director_name?: string | null
          director_title?: string | null
          district?: string | null
          id?: string
          license_key?: string | null
          logo_url?: string | null
          name_en?: string | null
          name_th: string
          phone?: string | null
          province?: string | null
          updated_at?: string | null
        }
        Update: {
          academic_head_name?: string | null
          address?: string | null
          affiliation?: string | null
          assessment_officer_name?: string | null
          created_at?: string | null
          deputy_director_name?: string | null
          director_name?: string | null
          director_title?: string | null
          district?: string | null
          id?: string
          license_key?: string | null
          logo_url?: string | null
          name_en?: string | null
          name_th?: string
          phone?: string | null
          province?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
      score_categories: {
        Row: {
          created_at: string | null
          id: string
          is_final: boolean | null
          is_midterm: boolean | null
          max_score: number
          name: string
          offering_id: string
          sort_order: number
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          id?: string
          is_final?: boolean | null
          is_midterm?: boolean | null
          max_score: number
          name: string
          offering_id: string
          sort_order: number
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          id?: string
          is_final?: boolean | null
          is_midterm?: boolean | null
          max_score?: number
          name?: string
          offering_id?: string
          sort_order?: number
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "score_categories_offering_id_fkey"
            columns: ["offering_id"]
            isOneToOne: false
            referencedRelation: "subject_offerings"
            referencedColumns: ["id"]
          },
        ]
      }
      scores: {
        Row: {
          category_id: string
          id: string
          recorded_at: string | null
          recorded_by: string | null
          score: number | null
          student_id: string
          updated_at: string | null
        }
        Insert: {
          category_id: string
          id?: string
          recorded_at?: string | null
          recorded_by?: string | null
          score?: number | null
          student_id: string
          updated_at?: string | null
        }
        Update: {
          category_id?: string
          id?: string
          recorded_at?: string | null
          recorded_by?: string | null
          score?: number | null
          student_id?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "scores_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "score_categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "scores_recorded_by_fkey"
            columns: ["recorded_by"]
            isOneToOne: false
            referencedRelation: "teachers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "scores_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "students"
            referencedColumns: ["id"]
          },
        ]
      }
      students: {
        Row: {
          auth_user_id: string | null
          birth_date: string | null
          created_at: string | null
          first_name: string
          gender: Database["public"]["Enums"]["gender"] | null
          id: string
          last_name: string
          national_id: string | null
          student_code: string
          title: string | null
          updated_at: string | null
        }
        Insert: {
          auth_user_id?: string | null
          birth_date?: string | null
          created_at?: string | null
          first_name: string
          gender?: Database["public"]["Enums"]["gender"] | null
          id?: string
          last_name: string
          national_id?: string | null
          student_code: string
          title?: string | null
          updated_at?: string | null
        }
        Update: {
          auth_user_id?: string | null
          birth_date?: string | null
          created_at?: string | null
          first_name?: string
          gender?: Database["public"]["Enums"]["gender"] | null
          id?: string
          last_name?: string
          national_id?: string | null
          student_code?: string
          title?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
      study_plan_subjects: {
        Row: {
          id: string
          sort_order: number | null
          study_plan_id: string
          subject_id: string
        }
        Insert: {
          id?: string
          sort_order?: number | null
          study_plan_id: string
          subject_id: string
        }
        Update: {
          id?: string
          sort_order?: number | null
          study_plan_id?: string
          subject_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "study_plan_subjects_study_plan_id_fkey"
            columns: ["study_plan_id"]
            isOneToOne: false
            referencedRelation: "study_plans"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "study_plan_subjects_subject_id_fkey"
            columns: ["subject_id"]
            isOneToOne: false
            referencedRelation: "subjects"
            referencedColumns: ["id"]
          },
        ]
      }
      study_plans: {
        Row: {
          created_at: string | null
          description: string | null
          grade_level_id: string
          id: string
          is_default: boolean | null
          name: string
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          description?: string | null
          grade_level_id: string
          id?: string
          is_default?: boolean | null
          name: string
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          description?: string | null
          grade_level_id?: string
          id?: string
          is_default?: boolean | null
          name?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "study_plans_grade_level_id_fkey"
            columns: ["grade_level_id"]
            isOneToOne: false
            referencedRelation: "grade_levels"
            referencedColumns: ["id"]
          },
        ]
      }
      subject_attendance: {
        Row: {
          id: string
          offering_id: string
          recorded_at: string
          recorded_by: string | null
          slot_in_week: number
          status: Database["public"]["Enums"]["attendance_status"]
          student_id: string
          week: number
        }
        Insert: {
          id?: string
          offering_id: string
          recorded_at?: string
          recorded_by?: string | null
          slot_in_week: number
          status: Database["public"]["Enums"]["attendance_status"]
          student_id: string
          week: number
        }
        Update: {
          id?: string
          offering_id?: string
          recorded_at?: string
          recorded_by?: string | null
          slot_in_week?: number
          status?: Database["public"]["Enums"]["attendance_status"]
          student_id?: string
          week?: number
        }
        Relationships: [
          {
            foreignKeyName: "subject_attendance_offering_id_fkey"
            columns: ["offering_id"]
            isOneToOne: false
            referencedRelation: "subject_offerings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "subject_attendance_recorded_by_fkey"
            columns: ["recorded_by"]
            isOneToOne: false
            referencedRelation: "teachers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "subject_attendance_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "students"
            referencedColumns: ["id"]
          },
        ]
      }
      subject_schedule_overrides: {
        Row: {
          created_at: string
          id: string
          offering_id: string
          session_date: string
          slot_in_week: number
          updated_at: string
          week: number
        }
        Insert: {
          created_at?: string
          id?: string
          offering_id: string
          session_date: string
          slot_in_week: number
          updated_at?: string
          week: number
        }
        Update: {
          created_at?: string
          id?: string
          offering_id?: string
          session_date?: string
          slot_in_week?: number
          updated_at?: string
          week?: number
        }
        Relationships: [
          {
            foreignKeyName: "subject_schedule_overrides_offering_id_fkey"
            columns: ["offering_id"]
            isOneToOne: false
            referencedRelation: "subject_offerings"
            referencedColumns: ["id"]
          },
        ]
      }
      subject_schedule_slots: {
        Row: {
          created_at: string
          id: string
          offering_id: string
          slot_in_week: number
          updated_at: string
          weekday: number
        }
        Insert: {
          created_at?: string
          id?: string
          offering_id: string
          slot_in_week: number
          updated_at?: string
          weekday: number
        }
        Update: {
          created_at?: string
          id?: string
          offering_id?: string
          slot_in_week?: number
          updated_at?: string
          weekday?: number
        }
        Relationships: [
          {
            foreignKeyName: "subject_schedule_slots_offering_id_fkey"
            columns: ["offering_id"]
            isOneToOne: false
            referencedRelation: "subject_offerings"
            referencedColumns: ["id"]
          },
        ]
      }
      subject_offerings: {
        Row: {
          classroom_id: string
          created_at: string | null
          id: string
          semester: number
          subject_id: string
          teacher_id: string | null
          updated_at: string | null
        }
        Insert: {
          classroom_id: string
          created_at?: string | null
          id?: string
          semester: number
          subject_id: string
          teacher_id?: string | null
          updated_at?: string | null
        }
        Update: {
          classroom_id?: string
          created_at?: string | null
          id?: string
          semester?: number
          subject_id?: string
          teacher_id?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "subject_offerings_classroom_id_fkey"
            columns: ["classroom_id"]
            isOneToOne: false
            referencedRelation: "classrooms"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "subject_offerings_classroom_id_fkey"
            columns: ["classroom_id"]
            isOneToOne: false
            referencedRelation: "v_classroom_names"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "subject_offerings_subject_id_fkey"
            columns: ["subject_id"]
            isOneToOne: false
            referencedRelation: "subjects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "subject_offerings_teacher_id_fkey"
            columns: ["teacher_id"]
            isOneToOne: false
            referencedRelation: "teachers"
            referencedColumns: ["id"]
          },
        ]
      }
      subjects: {
        Row: {
          academic_year_id: string
          category: Database["public"]["Enums"]["subject_category"]
          code: string
          created_at: string | null
          credit_hours: number | null
          grade_level_id: string
          grading_mode: Database["public"]["Enums"]["grading_mode"]
          hours_per_week: number | null
          hours_per_year: number | null
          id: string
          is_active: boolean | null
          learning_area_id: string | null
          name_th: string
          semester: number
          updated_at: string | null
        }
        Insert: {
          academic_year_id: string
          category: Database["public"]["Enums"]["subject_category"]
          code: string
          created_at?: string | null
          credit_hours?: number | null
          grade_level_id: string
          grading_mode: Database["public"]["Enums"]["grading_mode"]
          hours_per_week?: number | null
          hours_per_year?: number | null
          id?: string
          is_active?: boolean | null
          learning_area_id?: string | null
          name_th: string
          semester?: number
          updated_at?: string | null
        }
        Update: {
          academic_year_id?: string
          category?: Database["public"]["Enums"]["subject_category"]
          code?: string
          created_at?: string | null
          credit_hours?: number | null
          grade_level_id?: string
          grading_mode?: Database["public"]["Enums"]["grading_mode"]
          hours_per_week?: number | null
          hours_per_year?: number | null
          id?: string
          is_active?: boolean | null
          learning_area_id?: string | null
          name_th?: string
          semester?: number
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "subjects_grade_level_id_fkey"
            columns: ["grade_level_id"]
            isOneToOne: false
            referencedRelation: "grade_levels"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "subjects_learning_area_id_fkey"
            columns: ["learning_area_id"]
            isOneToOne: false
            referencedRelation: "learning_areas"
            referencedColumns: ["id"]
          },
        ]
      }
      teachers: {
        Row: {
          created_at: string | null
          department: string | null
          id: string
          is_academic_head: boolean | null
          is_department_head: boolean | null
          position: string | null
          subject_specialty: string | null
          teacher_code: string | null
          updated_at: string | null
          user_id: string
        }
        Insert: {
          created_at?: string | null
          department?: string | null
          id?: string
          is_academic_head?: boolean | null
          is_department_head?: boolean | null
          position?: string | null
          subject_specialty?: string | null
          teacher_code?: string | null
          updated_at?: string | null
          user_id: string
        }
        Update: {
          created_at?: string | null
          department?: string | null
          id?: string
          is_academic_head?: boolean | null
          is_department_head?: boolean | null
          position?: string | null
          subject_specialty?: string | null
          teacher_code?: string | null
          updated_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "teachers_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      users: {
        Row: {
          auth_user_id: string | null
          created_at: string | null
          email: string | null
          full_name: string
          id: string
          is_active: boolean | null
          phone: string | null
          role: Database["public"]["Enums"]["user_role"]
          title: string | null
          updated_at: string | null
          username: string
        }
        Insert: {
          auth_user_id?: string | null
          created_at?: string | null
          email?: string | null
          full_name: string
          id?: string
          is_active?: boolean | null
          phone?: string | null
          role: Database["public"]["Enums"]["user_role"]
          title?: string | null
          updated_at?: string | null
          username: string
        }
        Update: {
          auth_user_id?: string | null
          created_at?: string | null
          email?: string | null
          full_name?: string
          id?: string
          is_active?: boolean | null
          phone?: string | null
          role?: Database["public"]["Enums"]["user_role"]
          title?: string | null
          updated_at?: string | null
          username?: string
        }
        Relationships: []
      }
      workdays: {
        Row: {
          classroom_id: string
          created_at: string | null
          date: string
          id: string
          is_workday: boolean | null
        }
        Insert: {
          classroom_id: string
          created_at?: string | null
          date: string
          id?: string
          is_workday?: boolean | null
        }
        Update: {
          classroom_id?: string
          created_at?: string | null
          date?: string
          id?: string
          is_workday?: boolean | null
        }
        Relationships: [
          {
            foreignKeyName: "workdays_classroom_id_fkey"
            columns: ["classroom_id"]
            isOneToOne: false
            referencedRelation: "classrooms"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workdays_classroom_id_fkey"
            columns: ["classroom_id"]
            isOneToOne: false
            referencedRelation: "v_classroom_names"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      v_classroom_names: {
        Row: {
          academic_year_id: string | null
          display_name: string | null
          grade_level_id: string | null
          grade_short: string | null
          id: string | null
          room_number: number | null
        }
        Relationships: [
          {
            foreignKeyName: "classrooms_academic_year_id_fkey"
            columns: ["academic_year_id"]
            isOneToOne: false
            referencedRelation: "academic_years"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "classrooms_grade_level_id_fkey"
            columns: ["grade_level_id"]
            isOneToOne: false
            referencedRelation: "grade_levels"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Functions: {
      summarize_evaluation: {
        Args: { scores: number[]; threshold: number }
        Returns: number
      }
    }
    Enums: {
      attendance_status: "present" | "absent" | "leave" | "sick"
      classroom_status: "open" | "closed"
      gender: "male" | "female"
      grading_mode: "numeric" | "pass_fail"
      grading_period: "semester" | "annual"
      holiday_type: "government" | "school"
      homeroom_role: "primary" | "secondary"
      parent_relationship: "father" | "mother" | "guardian"
      pass_fail_result: "pass" | "fail"
      school_system: "primary" | "secondary"
      subject_category: "core" | "additional" | "activity"
      user_role: "admin" | "teacher"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      attendance_status: ["present", "absent", "leave", "sick"],
      classroom_status: ["open", "closed"],
      gender: ["male", "female"],
      grading_mode: ["numeric", "pass_fail"],
      grading_period: ["semester", "annual"],
      holiday_type: ["government", "school"],
      homeroom_role: ["primary", "secondary"],
      parent_relationship: ["father", "mother", "guardian"],
      pass_fail_result: ["pass", "fail"],
      school_system: ["primary", "secondary"],
      subject_category: ["core", "additional", "activity"],
      user_role: ["admin", "teacher"],
    },
  },
} as const
