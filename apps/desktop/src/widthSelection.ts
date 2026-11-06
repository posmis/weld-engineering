import type {WidthObjective,WidthStudyResult} from './contracts';
import {sameValue} from './projectHistory';
/** Validate server snapshot coherence; objective ranking and all mechanical values stay in Rust. */
export function validateWidthSelection(study:WidthStudyResult,objective?:WidthObjective){
 const rank=study.selection;
 const invalid=()=>{throw {code:'invalid_width_study_response'};};
 if(!objective){if(rank)invalid();return;}
 if(!rank||rank.objective!==objective||!study.source_project.user_limits)return invalid();
 if(!Number.isInteger(rank.eligible_count)||!Number.isInteger(rank.unavailable_count)||rank.eligible_count<0||rank.unavailable_count<0||rank.eligible_count+rank.unavailable_count>study.rows.length)return invalid();
 if(rank.selected_row_index===null){if(rank.objective_value!==null||(rank.status==='complete'&&rank.eligible_count>0))invalid();return;}
 const index=rank.selected_row_index,row=study.rows[index],q=row?.quantities,comparison=row?.comparison;
 const metric=objective==='minimum_volume'?q?.volume_mm3:q?.mass_kg;
 if(!Number.isInteger(index)||!row||row.status!=='complete'||row.quantity_error||!q?.complete||metric==null||rank.objective_value!==metric||!Number.isFinite(metric)||metric<=0||rank.status!=='complete'||rank.unavailable_count!==0||rank.eligible_count<1||!row.summary?.complete||comparison?.status!=='within_user_limits'||comparison.available!==comparison.total||!sameValue(comparison.limits,study.source_project.user_limits))invalid();
}
